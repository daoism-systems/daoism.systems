import {
	AdditiveBlending,
	ClampToEdgeWrapping,
	Color,
	HalfFloatType,
	LinearFilter,
	NodeMaterial,
	QuadMesh,
	RedFormat,
	RGFormat,
	RenderTarget,
	Vector2,
	type WebGPURenderer
} from 'three/webgpu';
import {
	Fn,
	abs,
	clamp,
	dot,
	exp,
	float,
	length,
	max,
	texture,
	uniform,
	uv,
	vec2,
	vec4
} from 'three/tsl';

export type VelocityNode = ReturnType<typeof texture>;

export interface SplatOptions {
	/** Override field's default uSplatRadius for this splat. */
	radius?: number;
	/** Override field's default uSplatForce for this splat. */
	force?: number;
}

export interface MouseField {
	splat(
		uv: { x: number; y: number },
		vx: number,
		vy: number,
		strength: number,
		options?: SplatOptions
	): void;
	step(deltaTime: number): void;
	/** Returns a stable TSL TextureNode bound to the current velocity field. */
	getVelocityNode(): VelocityNode;
	/** Sim resolution in pixels — needed by the dispersion display shader. */
	getSimSize(): Vector2;
	dispose(): void;
}

interface QueuedSplat {
	x: number;
	y: number;
	vx: number;
	vy: number;
	strength: number;
	radius?: number;
	force?: number;
}

export interface FluidMouseFieldOptions {
	/** Square sim resolution. */
	resolution?: number;
	/** Default splat force when caller does not override. */
	splatForce?: number;
	/** Default splat radius when caller does not override. */
	splatRadius?: number;
	/** Vorticity confinement strength — controls the "swirly" look. 0 disables. */
	curlStrength?: number;
	/** Multiplicative velocity damping per step (1.0 = no damping). */
	velocityDissipation?: number;
	/** Pressure dissipation between solver runs (1.0 keeps full pressure). */
	pressureDissipation?: number;
	/** Jacobi pressure iteration count. */
	pressureIterations?: number;
}

/**
 * Per-consumer splat overrides. The shared fluid field serves two consumers
 * that need DIFFERENT splat widths/strengths: the post-process dispersion
 * display (wide, forceful — tuned in the thousands) and the octagon-particle
 * pointer path (subtle, so particles drift instead of flying). Because both
 * splat into the same field, the only way to give them different radii/forces
 * is to override per splat here. These base values are what `_octagon`
 * (OctagonScene) and MainScene both render against.
 *
 * The Theatre/inspector "Splat Radius" control drives these live (see
 * `FluidSimulation`): it writes `PostFx.radius` directly and sets
 * `OctagonParticles.radius = PostFx.radius * OCTAGON_SPLAT_RADIUS_RATIO`, so one
 * knob scales both splats together while preserving the reference 2:1 ratio.
 * Writing the field-level `uSplatRadius` instead is inert — a per-splat `radius`
 * always shadows it inside `runSplats`.
 *
 * `radius: 0.1` corresponds to the VFX-JS reference's `splatRadius: 0.002`
 * since the splat shader divides by 50 inside the gaussian denominator.
 */
export const FluidProfiles: Record<'PostFx' | 'OctagonParticles', Required<SplatOptions>> = {
	/** Mouse-driven post-process distortion path. */
	PostFx: { radius: 0.1, force: 3000 },
	/** Octagon particle pointer path — subtler nudge so particles drift, not fly. */
	OctagonParticles: { radius: 0.05, force: 30 }
};

/**
 * Octagon splat radius expressed as a fraction of the PostFx splat radius
 * (0.05 / 0.1 = 0.5). Captured once from the base profiles so the single "Splat
 * Radius" control can scale both splats while keeping the particle splat at half
 * the distortion splat — the ratio `_octagon` ships.
 */
export const OCTAGON_SPLAT_RADIUS_RATIO =
	FluidProfiles.OctagonParticles.radius / FluidProfiles.PostFx.radius;

// Velocity buffers only ever read/write .xy (RG16F) and scalar buffers
// (curl, divergence, pressure) only ever read/write .x (R16F). Picking the
// narrowest renderable format cuts read/write bandwidth on the sim's 19
// passes by 50–75% versus RGBA16F, with no visual change.
const RT_OPTIONS_RG = {
	depthBuffer: false,
	stencilBuffer: false,
	type: HalfFloatType,
	format: RGFormat,
	magFilter: LinearFilter,
	minFilter: LinearFilter,
	wrapS: ClampToEdgeWrapping,
	wrapT: ClampToEdgeWrapping
} as const;

const RT_OPTIONS_R = {
	depthBuffer: false,
	stencilBuffer: false,
	type: HalfFloatType,
	format: RedFormat,
	magFilter: LinearFilter,
	minFilter: LinearFilter,
	wrapS: ClampToEdgeWrapping,
	wrapT: ClampToEdgeWrapping
} as const;

export class FluidMouseField implements MouseField {
	private renderer: WebGPURenderer;
	public readonly resolution: number;

	// Velocity field is ping-ponged between two render targets
	private velocityRead: RenderTarget;
	private velocityWrite: RenderTarget;
	// Single-buffer curl (scalar)
	private curlRT: RenderTarget;
	// Single-buffer divergence
	private divergenceRT: RenderTarget;
	// Pressure field is ping-ponged
	private pressureRead: RenderTarget;
	private pressureWrite: RenderTarget;

	private readonly quad = new QuadMesh();

	private splatMaterial!: NodeMaterial;
	private curlMaterial!: NodeMaterial;
	private vorticityMaterial!: NodeMaterial;
	private divergenceMaterial!: NodeMaterial;
	private clearPressureMaterial!: NodeMaterial;
	private pressureMaterial!: NodeMaterial;
	private gradientSubtractMaterial!: NodeMaterial;
	private advectionMaterial!: NodeMaterial;

	// Texture nodes that we update .value on between passes
	private velocityNode!: VelocityNode;
	private curlNode!: VelocityNode;
	private pressureNode!: VelocityNode;
	private divergenceNode!: VelocityNode;
	private advectVelocityNode!: VelocityNode;
	private gradientVelocityNode!: VelocityNode;
	private vorticityVelocityNode!: VelocityNode;
	// Stable node exposed to consumers — `.value` is updated to current read RT after step()
	private outputVelocityNode!: VelocityNode;

	public readonly uTexelSize = uniform(new Vector2(1 / 128, 1 / 128));
	public readonly uDt = uniform(1 / 60);
	public readonly uAspectRatio = uniform(1);
	public readonly uSplatPosition = uniform(new Vector2(0, 0));
	public readonly uSplatColor = uniform(new Color(0, 0, 0));
	public readonly uSplatRadius = uniform(0.01);
	public readonly uSplatForce = uniform(30);
	public readonly uCurlStrength = uniform(22);
	public readonly uVelocityDissipation = uniform(1.0);
	public readonly uPressureDissipation = uniform(1.0);
	public pressureIterations: number;

	private readonly simSize = new Vector2(128, 128);

	private splatQueue: QueuedSplat[] = [];

	// Idle-skip bookkeeping. We can't cheaply read GPU velocity each frame, so
	// instead estimate the field's remaining energy: every splat resets a TTL,
	// and each step decays it by velocityDissipation. Once the TTL falls below
	// epsilon we skip the whole pipeline until the next splat — this is a big
	// win on slow GPUs where 19 RT-binds/frame add up even with nothing moving.
	//
	// The TTL is tracked in the SAME units the splat pass writes into the
	// velocity texture (`vx * force * strength`, see runSplats) — an earlier
	// version tracked raw pointer velocity, ~700x smaller than the field it was
	// guarding, so the sim parked while the texture still held O(1) values.
	// Those froze in place (no advection/dissipation runs while skipped) and the
	// octagon particle kernel read them as permanent local activity — particles
	// stayed bloomed off the shape with no pointer near them.
	private activityEnergy = 0;
	// Must stay below OctagonFluidUniforms.uActivityFloor (0.1) — anything the
	// particle kernel can still feel must not be left frozen in the texture.
	private readonly activityEpsilon = 0.02;
	/** True once the velocity targets have been zeroed for the current idle stretch. */
	private idleFieldCleared = true;

	// Some callers construct FluidMouseField before the WebGPU backend is
	// initialized (renderer.init() not yet awaited). renderer.clear() throws
	// in that state, so defer the one-shot RT clear until the first step().
	private pendingClear = true;

	constructor(renderer: WebGPURenderer, options: FluidMouseFieldOptions = {}) {
		this.renderer = renderer;
		const opts = options;

		this.resolution = opts.resolution ?? 128;
		this.uTexelSize.value.set(1 / this.resolution, 1 / this.resolution);
		this.simSize.set(this.resolution, this.resolution);

		if (opts.splatForce !== undefined) this.uSplatForce.value = opts.splatForce;
		if (opts.splatRadius !== undefined) this.uSplatRadius.value = opts.splatRadius;
		if (opts.curlStrength !== undefined) this.uCurlStrength.value = opts.curlStrength;
		if (opts.velocityDissipation !== undefined)
			this.uVelocityDissipation.value = opts.velocityDissipation;
		if (opts.pressureDissipation !== undefined)
			this.uPressureDissipation.value = opts.pressureDissipation;
		this.pressureIterations = opts.pressureIterations ?? 12;

		this.velocityRead = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_RG);
		this.velocityWrite = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_RG);
		this.curlRT = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_R);
		this.divergenceRT = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_R);
		this.pressureRead = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_R);
		this.pressureWrite = new RenderTarget(this.resolution, this.resolution, RT_OPTIONS_R);

		this.buildMaterials();
	}

	// WebGPU normally zero-initializes textures, but some drivers/older browsers
	// don't, and the splat pass runs with autoClear off — so any garbage in the
	// initial velocity/pressure fields gets amplified by vorticity confinement
	// and produces "fluid all over the screen" without any input.
	private clearAllRenderTargets(): void {
		this.clearRenderTargets([
			this.velocityRead,
			this.velocityWrite,
			this.curlRT,
			this.divergenceRT,
			this.pressureRead,
			this.pressureWrite
		]);
	}

	private clearRenderTargets(targets: readonly RenderTarget[]): void {
		const renderer = this.renderer;
		const prevRT = renderer.getRenderTarget();
		const prevAutoClear = renderer.autoClear;
		const prevAutoClearColor = renderer.autoClearColor;
		renderer.autoClear = true;
		renderer.autoClearColor = true;
		for (const rt of targets) {
			renderer.setRenderTarget(rt);
			renderer.clear(true, false, false);
		}
		renderer.setRenderTarget(prevRT);
		renderer.autoClear = prevAutoClear;
		renderer.autoClearColor = prevAutoClearColor;
	}

	private buildMaterials(): void {
		const texelSize = this.uTexelSize;
		const aspect = this.uAspectRatio;
		const splatPos = this.uSplatPosition;
		const splatColor = this.uSplatColor;
		const splatRadius = this.uSplatRadius;
		const curlStrength = this.uCurlStrength;
		const velDiss = this.uVelocityDissipation;
		const pressDiss = this.uPressureDissipation;
		const dt = this.uDt;

		this.velocityNode = texture(this.velocityRead.texture);
		this.curlNode = texture(this.curlRT.texture);
		this.advectVelocityNode = texture(this.velocityRead.texture);
		this.gradientVelocityNode = texture(this.velocityRead.texture);
		this.vorticityVelocityNode = texture(this.velocityRead.texture);
		this.pressureNode = texture(this.pressureRead.texture);
		this.divergenceNode = texture(this.divergenceRT.texture);
		this.outputVelocityNode = texture(this.velocityRead.texture);

		// SPLAT — additive gaussian
		this.splatMaterial = new NodeMaterial();
		this.splatMaterial.transparent = true;
		this.splatMaterial.blending = AdditiveBlending;
		this.splatMaterial.depthTest = false;
		this.splatMaterial.depthWrite = false;
		this.splatMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const p = vUv.sub(splatPos).toVar();
			p.x.mulAssign(aspect);
			const factor = exp(dot(p, p).negate().div(splatRadius.div(50)));
			return vec4(splatColor.mul(factor), 1);
		})();

		// CURL — z-component of curl from x/y velocities (central differences).
		// Matches example: curl = 0.5 * (Ry - Lx - Tx + Bx) using vy across x and vx across y.
		this.curlMaterial = new NodeMaterial();
		this.curlMaterial.depthTest = false;
		this.curlMaterial.depthWrite = false;
		this.curlMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const L = this.velocityNode.sample(vUv.sub(vec2(texelSize.x, 0))).y;
			const R = this.velocityNode.sample(vUv.add(vec2(texelSize.x, 0))).y;
			const T = this.velocityNode.sample(vUv.add(vec2(0, texelSize.y))).x;
			const B = this.velocityNode.sample(vUv.sub(vec2(0, texelSize.y))).x;
			const c = R.sub(L).sub(T).add(B).mul(0.5);
			return vec4(c, 0, 0, 1);
		})();

		// VORTICITY CONFINEMENT — applies a swirling force back into velocity from |curl| gradient.
		this.vorticityMaterial = new NodeMaterial();
		this.vorticityMaterial.depthTest = false;
		this.vorticityMaterial.depthWrite = false;
		this.vorticityMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const L = abs(this.curlNode.sample(vUv.sub(vec2(texelSize.x, 0))).x);
			const R = abs(this.curlNode.sample(vUv.add(vec2(texelSize.x, 0))).x);
			const T = abs(this.curlNode.sample(vUv.add(vec2(0, texelSize.y))).x);
			const B = abs(this.curlNode.sample(vUv.sub(vec2(0, texelSize.y))).x);
			const C = this.curlNode.sample(vUv).x;
			const force = vec2(T.sub(B), R.sub(L)).toVar();
			const len = length(force);
			force.assign(force.div(max(len, float(0.0001))));
			force.mulAssign(curlStrength.mul(C));
			force.y.assign(force.y.negate());
			const vel = this.vorticityVelocityNode.sample(vUv).xy.toVar();
			vel.addAssign(force.mul(dt));
			vel.assign(clamp(vel, vec2(-1000, -1000), vec2(1000, 1000)));
			return vec4(vel, 0, 1);
		})();

		// DIVERGENCE — central differences of velocity
		this.divergenceMaterial = new NodeMaterial();
		this.divergenceMaterial.depthTest = false;
		this.divergenceMaterial.depthWrite = false;
		this.divergenceMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const L = this.velocityNode.sample(vUv.sub(vec2(texelSize.x, 0))).x;
			const R = this.velocityNode.sample(vUv.add(vec2(texelSize.x, 0))).x;
			const B = this.velocityNode.sample(vUv.sub(vec2(0, texelSize.y))).y;
			const T = this.velocityNode.sample(vUv.add(vec2(0, texelSize.y))).y;
			const div = R.sub(L).add(T.sub(B)).mul(0.5);
			return vec4(div, 0, 0, 1);
		})();

		// CLEAR PRESSURE — multiply existing pressure by dissipation
		this.clearPressureMaterial = new NodeMaterial();
		this.clearPressureMaterial.depthTest = false;
		this.clearPressureMaterial.depthWrite = false;
		this.clearPressureMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const p = this.pressureNode.sample(vUv).x;
			return vec4(p.mul(pressDiss), 0, 0, 1);
		})();

		// PRESSURE JACOBI — (L + R + B + T - divergence) * 0.25
		this.pressureMaterial = new NodeMaterial();
		this.pressureMaterial.depthTest = false;
		this.pressureMaterial.depthWrite = false;
		this.pressureMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const L = this.pressureNode.sample(vUv.sub(vec2(texelSize.x, 0))).x;
			const R = this.pressureNode.sample(vUv.add(vec2(texelSize.x, 0))).x;
			const B = this.pressureNode.sample(vUv.sub(vec2(0, texelSize.y))).x;
			const T = this.pressureNode.sample(vUv.add(vec2(0, texelSize.y))).x;
			const d = this.divergenceNode.sample(vUv).x;
			const next = L.add(R).add(B).add(T).sub(d).mul(0.25);
			return vec4(next, 0, 0, 1);
		})();

		// GRADIENT SUBTRACT — vel - grad(pressure)
		this.gradientSubtractMaterial = new NodeMaterial();
		this.gradientSubtractMaterial.depthTest = false;
		this.gradientSubtractMaterial.depthWrite = false;
		this.gradientSubtractMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const L = this.pressureNode.sample(vUv.sub(vec2(texelSize.x, 0))).x;
			const R = this.pressureNode.sample(vUv.add(vec2(texelSize.x, 0))).x;
			const B = this.pressureNode.sample(vUv.sub(vec2(0, texelSize.y))).x;
			const T = this.pressureNode.sample(vUv.add(vec2(0, texelSize.y))).x;
			const v = this.gradientVelocityNode.sample(vUv);
			const newVel = v.xy.sub(vec2(R.sub(L), T.sub(B)).mul(0.5));
			return vec4(newVel, 0, 1);
		})();

		// ADVECTION — semi-Lagrangian. Dissipation is a per-frame retention factor
		// (matches particles.sujen.co convention): velocityDissipation = 0.96 →
		// 4%/frame loss. 1.0 disables damping entirely.
		this.advectionMaterial = new NodeMaterial();
		this.advectionMaterial.depthTest = false;
		this.advectionMaterial.depthWrite = false;
		this.advectionMaterial.fragmentNode = Fn(() => {
			const vUv = uv();
			const v = this.advectVelocityNode.sample(vUv);
			const coord = vUv.sub(v.xy.mul(texelSize).mul(dt));
			const advected = this.advectVelocityNode.sample(coord);
			return vec4(advected.xy.mul(velDiss), 0, 1);
		})();
	}

	public splat(
		uv: { x: number; y: number },
		vx: number,
		vy: number,
		strength: number,
		options?: SplatOptions
	): void {
		this.splatQueue.push({
			x: uv.x,
			y: uv.y,
			vx,
			vy,
			strength,
			radius: options?.radius,
			force: options?.force
		});
		// Reset the idle TTL to this splat's peak contribution to the velocity
		// texture — same expression runSplats feeds to uSplatColor, so the TTL
		// decays in lockstep with the values consumers actually sample.
		const mag = Math.abs(vx) + Math.abs(vy);
		const force = options?.force ?? this.uSplatForce.value;
		this.activityEnergy = Math.max(this.activityEnergy, mag * force * strength);
		this.idleFieldCleared = false;
	}

	public step(deltaTime: number): void {
		// Lazy one-shot RT clear — the constructor can't do this since callers
		// may instantiate us before the WebGPU backend is initialized. By the
		// time we're stepping we're inside an animation frame, so the renderer
		// is guaranteed live.
		if (this.pendingClear) {
			this.clearAllRenderTargets();
			this.pendingClear = false;
		}

		// Idle-skip: nothing to do if no pending splats and the field has
		// effectively decayed to zero. Saves ~19 RT-binds per frame on slow
		// GPUs whenever the user isn't interacting.
		if (this.splatQueue.length === 0 && this.activityEnergy < this.activityEpsilon) {
			// Zero the velocity targets on the way into idle. Skipping stops
			// dissipation, so whatever is left in the texture would otherwise sit
			// there indefinitely; consumers that gate on field magnitude (the
			// octagon particle kernel) must see a clean zero, not a frozen tail.
			if (!this.idleFieldCleared) {
				this.clearRenderTargets([this.velocityRead, this.velocityWrite]);
				this.outputVelocityNode.value = this.velocityRead.texture;
				this.idleFieldCleared = true;
			}
			return;
		}

		// Clamp dt on BOTH ends. The low clamp avoids div-by-zero for very fast
		// frames; the high clamp is the critical one — without it, a tab-switch,
		// GPU hitch, or slow first frame produces a giant dt that the
		// semi-Lagrangian advection and vorticity confinement amplify into a
		// screen-filling explosion (CFL violation).
		const dt = Math.min(Math.max(deltaTime, 1 / 240), 1 / 30);
		this.uDt.value = dt;

		// Decay the idle TTL by the same dissipation factor as the velocity field.
		this.activityEnergy *= this.uVelocityDissipation.value;

		// Three's renderer auto-clears the bound RT before each render() call
		// (autoClearColor=true by default). For the splat pass that wrecks
		// additive accumulation — every splat would overwrite a freshly-cleared
		// buffer and the field would have no inertia. The other passes each
		// fully overwrite every fragment, so disabling auto-clear is safe for
		// them too. We restore caller state at the end.
		const renderer = this.renderer;
		const prevAutoClear = renderer.autoClear;
		const prevAutoClearColor = renderer.autoClearColor;
		renderer.autoClear = false;
		renderer.autoClearColor = false;

		this.runSplats();
		if (this.uCurlStrength.value > 0) {
			this.runCurl();
			this.runVorticity();
		}
		this.runDivergence();
		this.runClearPressure();
		for (let i = 0; i < this.pressureIterations; i++) {
			this.runPressureIteration();
		}
		this.runGradientSubtract();
		this.runAdvection();

		renderer.autoClear = prevAutoClear;
		renderer.autoClearColor = prevAutoClearColor;

		this.outputVelocityNode.value = this.velocityRead.texture;
	}

	/**
	 * Adopt a recreated WebGPURenderer after GPU-context recovery. The field
	 * instance must survive recovery: consumers bake `outputVelocityNode` into
	 * their TSL graphs (octagon physics kernels, train-slider materials, the
	 * post-FX dispersion pass), so recreating the field would leave them all
	 * sampling a disposed texture. Render targets and materials are
	 * renderer-agnostic three.js objects the new backend lazily rebuilds; only
	 * the RT *contents* are undefined on the new device, so queue the one-shot
	 * clear and drop any stale splats/energy from before the recovery.
	 */
	public rebindRenderer(renderer: WebGPURenderer): void {
		this.renderer = renderer;
		this.pendingClear = true;
		this.splatQueue.length = 0;
		this.activityEnergy = 0;
		// pendingClear zeroes every RT on the next step(), which is exactly the
		// "cleared for the current idle stretch" state this flag records.
		this.idleFieldCleared = true;
		this.outputVelocityNode.value = this.velocityRead.texture;
	}

	/**
	 * Forces every offscreen fluid pass to create its GPU pipeline before the
	 * field is visible. Scene-level renderer.compileAsync() cannot see these
	 * QuadMesh materials because they are not part of the main scene graph.
	 */
	public warmup(): void {
		this.splat({ x: 0.5, y: 0.5 }, 0, 0, 0);
		this.step(1 / 60);
		this.splatQueue.length = 0;
		this.activityEnergy = 0;
		this.outputVelocityNode.value = this.velocityRead.texture;
	}

	private runSplats(): void {
		if (this.splatQueue.length === 0) return;

		const renderer = this.renderer;
		const previousRT = renderer.getRenderTarget();
		const baseRadius = this.uSplatRadius.value;
		const baseForce = this.uSplatForce.value;

		this.quad.material = this.splatMaterial;

		for (const s of this.splatQueue) {
			const force = s.force ?? baseForce;
			const radius = s.radius ?? baseRadius;

			this.uSplatPosition.value.set(s.x, s.y);
			this.uSplatColor.value.setRGB(s.vx * force * s.strength, s.vy * force * s.strength, 0);
			this.uSplatRadius.value = radius;

			renderer.setRenderTarget(this.velocityRead);
			renderer.render(this.quad, this.quad.camera);
		}

		// Restore the field-level default so subsequent passes/uniform reads see it.
		this.uSplatRadius.value = baseRadius;
		this.splatQueue.length = 0;
		renderer.setRenderTarget(previousRT);
	}

	private runCurl(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.velocityNode.value = this.velocityRead.texture;
		this.quad.material = this.curlMaterial;
		renderer.setRenderTarget(this.curlRT);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
	}

	private runVorticity(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.curlNode.value = this.curlRT.texture;
		this.vorticityVelocityNode.value = this.velocityRead.texture;
		this.quad.material = this.vorticityMaterial;
		renderer.setRenderTarget(this.velocityWrite);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
		this.swapVelocity();
	}

	private runDivergence(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.velocityNode.value = this.velocityRead.texture;
		this.quad.material = this.divergenceMaterial;
		renderer.setRenderTarget(this.divergenceRT);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
	}

	private runClearPressure(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.pressureNode.value = this.pressureRead.texture;
		this.quad.material = this.clearPressureMaterial;
		renderer.setRenderTarget(this.pressureWrite);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
		this.swapPressure();
	}

	private runPressureIteration(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.pressureNode.value = this.pressureRead.texture;
		this.divergenceNode.value = this.divergenceRT.texture;
		this.quad.material = this.pressureMaterial;
		renderer.setRenderTarget(this.pressureWrite);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
		this.swapPressure();
	}

	private runGradientSubtract(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.pressureNode.value = this.pressureRead.texture;
		this.gradientVelocityNode.value = this.velocityRead.texture;
		this.quad.material = this.gradientSubtractMaterial;
		renderer.setRenderTarget(this.velocityWrite);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
		this.swapVelocity();
	}

	private runAdvection(): void {
		const renderer = this.renderer;
		const prev = renderer.getRenderTarget();
		this.advectVelocityNode.value = this.velocityRead.texture;
		this.quad.material = this.advectionMaterial;
		renderer.setRenderTarget(this.velocityWrite);
		renderer.render(this.quad, this.quad.camera);
		renderer.setRenderTarget(prev);
		this.swapVelocity();
	}

	private swapVelocity(): void {
		const tmp = this.velocityRead;
		this.velocityRead = this.velocityWrite;
		this.velocityWrite = tmp;
	}

	private swapPressure(): void {
		const tmp = this.pressureRead;
		this.pressureRead = this.pressureWrite;
		this.pressureWrite = tmp;
	}

	public getVelocityNode(): VelocityNode {
		return this.outputVelocityNode;
	}

	public getSimSize(): Vector2 {
		return this.simSize;
	}

	public dispose(): void {
		this.velocityRead.dispose();
		this.velocityWrite.dispose();
		this.curlRT.dispose();
		this.divergenceRT.dispose();
		this.pressureRead.dispose();
		this.pressureWrite.dispose();
		this.splatMaterial.dispose();
		this.curlMaterial.dispose();
		this.vorticityMaterial.dispose();
		this.divergenceMaterial.dispose();
		this.clearPressureMaterial.dispose();
		this.pressureMaterial.dispose();
		this.gradientSubtractMaterial.dispose();
		this.advectionMaterial.dispose();
	}
}
