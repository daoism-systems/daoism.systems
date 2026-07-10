/**
 * PyramidVAT — GPU-driven Vertex Animation Texture for pyramid meshes.
 *
 * Replaces 409 individual meshes + 1,428 AnimationMixer channels with a
 * single merged mesh animated via a DataTexture lookup in the vertex shader.
 *
 * Binary format (pyramids_vat.bin):
 *   Header (32 bytes):
 *     uint32  objectCount
 *     uint32  frameCount
 *     float32 timeStart      seconds of the first baked frame
 *     float32 timeEnd        seconds of the last baked frame (= morph end after
 *                            the bake trims the trailing static held pose)
 *     float32 fps
 *     float32 fullDuration   seconds the *content timeline* maps 0..1 across
 *                            (the original, untrimmed clip length). When the
 *                            bake trims the held tail, timeEnd < fullDuration:
 *                            progress maps to source time over fullDuration,
 *                            then clamps into the baked [timeStart, timeEnd]
 *                            window so the morph completes at the same scroll
 *                            point it did before the trim. Legacy bins wrote 0
 *                            here (zero padding) → falls back to timeEnd.
 *     8 bytes padding
 *   Data (frameCount * objectCount * 12 floats):
 *     Per frame, per object: mat4x3 row-major (3 rows × 4 cols)
 */

import * as THREE from 'three/webgpu';
import {
	Fn,
	vec3,
	vec4,
	float,
	int,
	uniform,
	attribute,
	texture,
	positionLocal,
	normalLocal,
	transformNormalToView,
	floor,
	fract,
	mix,
	clamp
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SharedMaterials } from '../materials/SharedMaterials';

/**
 * Fetch a binary asset while reporting download progress in bytes. Streams the
 * response body so the loading bar can reflect large assets (the VAT `.bin`)
 * that `Response.arrayBuffer()` would otherwise download silently. `total` comes
 * from Content-Length (0 when the header is absent); callers that need a stable
 * denominator should use a known size rather than relying on `total`.
 */
async function fetchArrayBufferWithProgress(
	url: string,
	onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	const total = Number(response.headers.get('content-length')) || 0;

	// No readable stream (older browsers / opaque bodies): fall back to a single
	// buffered read so the asset still loads, just without incremental progress.
	if (!response.body) {
		const buffer = await response.arrayBuffer();
		onProgress?.(buffer.byteLength, total || buffer.byteLength);
		return buffer;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.byteLength;
		onProgress?.(loaded, total);
	}

	const out = new ArrayBuffer(loaded);
	const view = new Uint8Array(out);
	let offset = 0;
	for (const chunk of chunks) {
		view.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/** True if the buffer starts with the gzip magic bytes (0x1f 0x8b). */
function isGzip(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < 2) return false;
	const b = new Uint8Array(buffer, 0, 2);
	return b[0] === 0x1f && b[1] === 0x8b;
}

/**
 * Inflate a gzip buffer via the platform `DecompressionStream`. The VAT `.bin`
 * is float32 rigid transforms with long all-zero (scale-0) runs, so it gzips
 * ~12× (22.9 MB → 1.8 MB) losslessly — far better than any quantization, which
 * only makes the data less compressible. We ship the `.gz` and inflate here.
 * Every browser that can run this WebGPU scene has DecompressionStream
 * (Chrome 80+, Safari 16.4+, Firefox 113+).
 */
async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	if (typeof DecompressionStream === 'undefined') {
		throw new Error('PyramidVAT: DecompressionStream unavailable — cannot inflate gzipped VAT');
	}
	const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
	return await new Response(stream).arrayBuffer();
}

export interface PyramidVATConfig {
	/** Number of objects baked into the VAT */
	objectCount: number;
	/** Number of animation frames */
	frameCount: number;
	/** Start time in seconds */
	timeStart: number;
	/** End time in seconds (last baked frame; = morph end when the tail is trimmed) */
	timeEnd: number;
	/** Original bake FPS */
	fps: number;
	/**
	 * Seconds the content timeline maps progress 0..1 across (original untrimmed
	 * clip length). Equals timeEnd for an untrimmed bake; larger when the held
	 * tail was trimmed. 0/absent in legacy bins → treated as timeEnd.
	 */
	fullDuration: number;
}

export class PyramidVAT {
	private mesh: THREE.Mesh | null = null;
	private vatTexture: THREE.DataTexture | null = null;
	private config: PyramidVATConfig | null = null;
	private progressUniform = uniform(0.0);
	/** Global max object scale across the whole bake — see getMaxObjectScale. */
	private maxObjectScale = 0;
	/** Baked-frame position (0..frameCount-1) for the current progress. Read by the
	 *  VAT-driven particle cloud so it samples the exact frame the solid renders. */
	private currentFrameFloat = 0;
	private gltfLoader: GLTFLoader;

	constructor(gltfLoader: GLTFLoader) {
		this.gltfLoader = gltfLoader;
	}

	/**
	 * Load the merged mesh and VAT data, create the animated mesh.
	 *
	 * `onVatProgress(loaded, total)` reports the download in bytes. The VAT is the
	 * single largest runtime asset; a bare `arrayBuffer()` gave no progress, so on
	 * cold caches (Vercel/incognito) the loading bar froze through its entire
	 * download. Stream it so the bytes are observable. When `vatUrl` points at the
	 * gzipped bin (the shipped default), progress tracks the small compressed
	 * transfer (~1.8 MB) and the buffer is inflated before parsing.
	 */
	async load(
		meshUrl: string,
		vatUrl: string,
		onVatProgress?: (loaded: number, total: number) => void
	): Promise<THREE.Mesh | null> {
		const [gltf, downloaded] = await Promise.all([
			this.gltfLoader.loadAsync(meshUrl),
			fetchArrayBufferWithProgress(vatUrl, onVatProgress)
		]);

		// Inflate when gzipped; tolerate a raw .bin so the loader works against
		// either asset without a config flag.
		const vatBuffer = isGzip(downloaded) ? await gunzip(downloaded) : downloaded;

		// Parse VAT header
		const header = new DataView(vatBuffer);
		const timeEnd = header.getFloat32(12, true);
		const fullDuration = header.getFloat32(20, true);
		this.config = {
			objectCount: header.getUint32(0, true),
			frameCount: header.getUint32(4, true),
			timeStart: header.getFloat32(8, true),
			timeEnd,
			fps: header.getFloat32(16, true),
			// Legacy bins left this padding at 0; fall back to timeEnd so an
			// untrimmed bake maps progress identically to before.
			fullDuration: fullDuration > 0 ? fullDuration : timeEnd
		};

		// Parse transform data (after 32-byte header)
		const floatData = new Float32Array(vatBuffer, 32);

		// One-time scan for the global max object scale across the whole bake.
		// The GPU-driven particle cloud fades each dot's radius by
		// objScale/maxObjectScale; the CPU path's per-frame running max converged
		// to this same value, so a constant is equivalent (and stable from frame 0).
		{
			let maxScale = 0;
			const total = this.config.frameCount * this.config.objectCount;
			for (let i = 0; i < total; i++) {
				const s = i * 12;
				for (let col = 0; col < 3; col++) {
					const a = floatData[s + col];
					const b = floatData[s + 4 + col];
					const c = floatData[s + 8 + col];
					const len = Math.sqrt(a * a + b * b + c * c);
					if (len > maxScale) maxScale = len;
				}
			}
			this.maxObjectScale = maxScale;
		}

		// Create DataTexture: each object needs 3 pixels (3 rows of mat4x3)
		// Width = objectCount * 3, Height = frameCount
		const texWidth = this.config.objectCount * 3;
		const texHeight = this.config.frameCount;
		const texData = new Float32Array(texWidth * texHeight * 4); // RGBA

		for (let frame = 0; frame < this.config.frameCount; frame++) {
			for (let obj = 0; obj < this.config.objectCount; obj++) {
				const srcOffset = (frame * this.config.objectCount + obj) * 12;
				const dstBase = (frame * texWidth + obj * 3) * 4;

				// Row 0: [m00, m01, m02, m03] → pixel 0
				texData[dstBase + 0] = floatData[srcOffset + 0];
				texData[dstBase + 1] = floatData[srcOffset + 1];
				texData[dstBase + 2] = floatData[srcOffset + 2];
				texData[dstBase + 3] = floatData[srcOffset + 3];

				// Row 1: [m10, m11, m12, m13] → pixel 1
				texData[dstBase + 4] = floatData[srcOffset + 4];
				texData[dstBase + 5] = floatData[srcOffset + 5];
				texData[dstBase + 6] = floatData[srcOffset + 6];
				texData[dstBase + 7] = floatData[srcOffset + 7];

				// Row 2: [m20, m21, m22, m23] → pixel 2
				texData[dstBase + 8] = floatData[srcOffset + 8];
				texData[dstBase + 9] = floatData[srcOffset + 9];
				texData[dstBase + 10] = floatData[srcOffset + 10];
				texData[dstBase + 11] = floatData[srcOffset + 11];
			}
		}

		this.vatTexture = new THREE.DataTexture(
			texData,
			texWidth,
			texHeight,
			THREE.RGBAFormat,
			THREE.FloatType
		);
		this.vatTexture.minFilter = THREE.NearestFilter;
		this.vatTexture.magFilter = THREE.NearestFilter;
		this.vatTexture.needsUpdate = true;

		// Find the merged mesh in the GLTF
		let sourceMesh: THREE.Mesh | null = null;
		gltf.scene.traverse((child) => {
			if (child instanceof THREE.Mesh && !sourceMesh) {
				sourceMesh = child;
			}
		});

		if (!sourceMesh) {
			console.error('PyramidVAT: No mesh found in merged GLB');
			return null;
		}

		// Create the material with VAT position override
		const material = this.createVATMaterial();

		this.mesh = new THREE.Mesh((sourceMesh as THREE.Mesh).geometry, material);
		this.mesh.name = 'PyramidVAT';
		this.mesh.frustumCulled = false; // Vertices move in shader, bounding box is wrong
		this.mesh.receiveShadow = true;
		this.mesh.castShadow = false;

		return this.mesh;
	}

	private createVATMaterial(): MeshStandardNodeMaterial {
		// Fresh clone (not the singleton) so the VAT position/normal overrides
		// below don't leak onto other pyramid meshes. The solid's PBR + rim
		// uniforms are shared via the factory, so Theatre keyframes still drive
		// every pillar. The rim's `normalView` picks up the animated
		// `normalNode` set below, so the Fresnel tracks the morphing geometry.
		const material = SharedMaterials.createPyramidSolidMaterialClone();
		material.side = THREE.DoubleSide;

		const vatTex = this.vatTexture!;
		const config = this.config!;
		const progressU = this.progressUniform;
		const texWidthU = uniform(config.objectCount * 3);
		const texHeightU = uniform(config.frameCount);
		const objectCountU = uniform(config.objectCount);

		// Position node: sample VAT and transform vertex
		material.positionNode = Fn(() => {
			// Read objectIndex from vertex color (stored in R channel as idx/512)
			const objColorR = (attribute('color', 'vec4') as any).x as ReturnType<typeof float>;
			const objIdx = int(floor(objColorR.mul(512.0).add(0.5)));

			// Compute frame from progress (0..1 maps to 0..frameCount-1)
			const frameF = clamp(progressU, 0.0, 1.0).mul(float(config.frameCount - 1));
			const frame0 = int(floor(frameF));
			const frame1 = int(clamp(float(frame0.add(1)), 0.0, float(config.frameCount - 1)));
			const frameFrac = fract(frameF);

			// Sample mat4x3 for frame0
			const sampleRow = (
				frame: ReturnType<typeof int>,
				objI: ReturnType<typeof int>,
				row: number
			) => {
				const px = float(objI.mul(3).add(row)).add(0.5).div(texWidthU);
				const py = float(frame).add(0.5).div(texHeightU);
				return texture(vatTex, vec3(px, py, 0).xy);
			};

			// Frame 0 matrix
			const r0_f0 = sampleRow(frame0, objIdx, 0);
			const r1_f0 = sampleRow(frame0, objIdx, 1);
			const r2_f0 = sampleRow(frame0, objIdx, 2);

			// Frame 1 matrix
			const r0_f1 = sampleRow(frame1, objIdx, 0);
			const r1_f1 = sampleRow(frame1, objIdx, 1);
			const r2_f1 = sampleRow(frame1, objIdx, 2);

			// Interpolate rows
			const r0 = mix(r0_f0, r0_f1, frameFrac);
			const r1 = mix(r1_f0, r1_f1, frameFrac);
			const r2 = mix(r2_f0, r2_f1, frameFrac);

			// Apply mat4x3 to position: newPos = mat * [pos, 1]
			const pos = positionLocal;
			const wx = r0.x.mul(pos.x).add(r0.y.mul(pos.y)).add(r0.z.mul(pos.z)).add(r0.w);
			const wy = r1.x.mul(pos.x).add(r1.y.mul(pos.y)).add(r1.z.mul(pos.z)).add(r1.w);
			const wz = r2.x.mul(pos.x).add(r2.y.mul(pos.y)).add(r2.z.mul(pos.z)).add(r2.w);

			return vec3(wx, wy, wz);
		})();

		// Normal node: transform normal by upper-left 3x3 of the matrix
		material.normalNode = Fn(() => {
			const objColorR = (attribute('color', 'vec4') as any).x as ReturnType<typeof float>;
			const objIdx = int(floor(objColorR.mul(512.0).add(0.5)));

			const frameF = clamp(progressU, 0.0, 1.0).mul(float(config.frameCount - 1));
			const frame0 = int(floor(frameF));
			const frame1 = int(clamp(float(frame0.add(1)), 0.0, float(config.frameCount - 1)));
			const frameFrac = fract(frameF);

			const sampleRow = (
				frame: ReturnType<typeof int>,
				objI: ReturnType<typeof int>,
				row: number
			) => {
				const px = float(objI.mul(3).add(row)).add(0.5).div(texWidthU);
				const py = float(frame).add(0.5).div(texHeightU);
				return texture(vatTex, vec3(px, py, 0).xy);
			};

			const r0_f0 = sampleRow(frame0, objIdx, 0);
			const r1_f0 = sampleRow(frame0, objIdx, 1);
			const r2_f0 = sampleRow(frame0, objIdx, 2);

			const r0_f1 = sampleRow(frame1, objIdx, 0);
			const r1_f1 = sampleRow(frame1, objIdx, 1);
			const r2_f1 = sampleRow(frame1, objIdx, 2);

			const r0 = mix(r0_f0, r0_f1, frameFrac);
			const r1 = mix(r1_f0, r1_f1, frameFrac);
			const r2 = mix(r2_f0, r2_f1, frameFrac);

			// Transform normal by 3x3 rotation part (ignoring translation).
			// material.normalNode is expected to return a view-space normal: without
			// the final transformNormalToView the EnvironmentNode samples IBL with a
			// normal that misses the model matrix, so reflections stay glued to the
			// surface as the pyramid pivot rotates.
			const n = normalLocal;
			const nx = r0.x.mul(n.x).add(r0.y.mul(n.y)).add(r0.z.mul(n.z));
			const ny = r1.x.mul(n.x).add(r1.y.mul(n.y)).add(r1.z.mul(n.z));
			const nz = r2.x.mul(n.x).add(r2.y.mul(n.y)).add(r2.z.mul(n.z));

			return transformNormalToView(vec3(nx, ny, nz).normalize());
		})();

		return material;
	}

	/**
	 * Set animation progress (0..1, content-timeline progress).
	 *
	 * Maps content progress → source time across the full (untrimmed) clip, then
	 * clamps into the baked [timeStart, timeEnd] window and renormalizes to the
	 * 0..1 the shader expects. This keeps the morph completing at the same scroll
	 * point even though the trailing held-pose frames are no longer baked.
	 */
	setProgress(progress: number): void {
		const cfg = this.config;
		if (!cfg) {
			this.progressUniform.value = progress;
			return;
		}
		const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
		const sourceTime = clamped * cfg.fullDuration;
		const span = Math.max(1e-6, cfg.timeEnd - cfg.timeStart);
		const frameProgress = (sourceTime - cfg.timeStart) / span;
		const fp = frameProgress < 0 ? 0 : frameProgress > 1 ? 1 : frameProgress;
		this.progressUniform.value = fp;
		this.currentFrameFloat = fp * (cfg.frameCount - 1);
	}

	getObjectCount(): number {
		return this.config?.objectCount ?? 0;
	}

	/**
	 * Global max object scale across every baked frame. Used by the GPU particle
	 * cloud as the constant denominator of the radius fade (`objScale / max`).
	 */
	getMaxObjectScale(): number {
		return this.maxObjectScale;
	}

	/**
	 * TSL helper: build the interpolated mat4x3 rows for object `objIdx` at the
	 * frame selected by this VAT's progress uniform — the exact sampling scheme
	 * `createVATMaterial` uses for the solid mesh, sharing the same progress
	 * uniform and texture, so a consumer mesh (the particle cloud) lands on
	 * identical transforms with no possibility of desync. Must be called inside
	 * a TSL `Fn()` body, after `load()` has resolved.
	 */
	tslSampleObjectRows(objIdx: ReturnType<typeof int>): { r0: any; r1: any; r2: any } | null {
		const vatTex = this.vatTexture;
		const config = this.config;
		if (!vatTex || !config) return null;

		const texWidthU = uniform(config.objectCount * 3);
		const texHeightU = uniform(config.frameCount);
		const progressU = this.progressUniform;

		const frameF = clamp(progressU, 0.0, 1.0).mul(float(config.frameCount - 1));
		const frame0 = int(floor(frameF));
		const frame1 = int(clamp(float(frame0.add(1)), 0.0, float(config.frameCount - 1)));
		const frameFrac = fract(frameF);

		const sampleRow = (frame: ReturnType<typeof int>, row: number) => {
			const px = float(objIdx.mul(3).add(row)).add(0.5).div(texWidthU);
			const py = float(frame).add(0.5).div(texHeightU);
			return texture(vatTex, vec3(px, py, 0).xy);
		};

		return {
			r0: mix(sampleRow(frame0, 0), sampleRow(frame1, 0), frameFrac),
			r1: mix(sampleRow(frame0, 1), sampleRow(frame1, 1), frameFrac),
			r2: mix(sampleRow(frame0, 2), sampleRow(frame1, 2), frameFrac)
		};
	}

	/** Baked-frame position (0..frameCount-1) corresponding to the current progress. */
	getCurrentFrameFloat(): number {
		return this.currentFrameFloat;
	}

	/** Merged solid geometry (positions + per-vertex objectIndex in vertex color). */
	getMergedGeometry(): THREE.BufferGeometry | null {
		return this.mesh ? (this.mesh.geometry as THREE.BufferGeometry) : null;
	}

	/**
	 * Sample one object's animated mat4x3 at `frameFloat`, written row-major into
	 * `out` (12 floats: 3 rows × 4 cols). Linearly interpolates between the two
	 * bracketing baked frames — identical scheme to the shader — so CPU-driven
	 * particles land exactly where the GPU draws the solid. Reads from the
	 * DataTexture's backing array (no extra copy).
	 */
	sampleObjectMatrix(obj: number, frameFloat: number, out: Float32Array | number[]): void {
		const cfg = this.config;
		const tex = this.vatTexture;
		if (!cfg || !tex) return;
		const data = tex.image.data as unknown as Float32Array;
		const texWidth = cfg.objectCount * 3;
		const ff =
			frameFloat < 0 ? 0 : frameFloat > cfg.frameCount - 1 ? cfg.frameCount - 1 : frameFloat;
		const f0 = Math.floor(ff);
		const f1 = Math.min(f0 + 1, cfg.frameCount - 1);
		const fr = ff - f0;
		const b0 = (f0 * texWidth + obj * 3) * 4;
		const b1 = (f1 * texWidth + obj * 3) * 4;
		for (let row = 0; row < 3; row++) {
			const o0 = b0 + row * 4;
			const o1 = b1 + row * 4;
			const d = row * 4;
			out[d + 0] = data[o0 + 0] * (1 - fr) + data[o1 + 0] * fr;
			out[d + 1] = data[o0 + 1] * (1 - fr) + data[o1 + 1] * fr;
			out[d + 2] = data[o0 + 2] * (1 - fr) + data[o1 + 2] * fr;
			out[d + 3] = data[o0 + 3] * (1 - fr) + data[o1 + 3] * fr;
		}
	}

	getMesh(): THREE.Mesh | null {
		return this.mesh;
	}

	dispose(): void {
		if (this.vatTexture) {
			this.vatTexture.dispose();
			this.vatTexture = null;
		}
		if (this.mesh) {
			this.mesh.geometry.dispose();
			if (this.mesh.material instanceof THREE.Material) {
				this.mesh.material.dispose();
			}
			this.mesh = null;
		}
		this.config = null;
	}
}
