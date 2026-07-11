import * as THREE from 'three/webgpu';
import { vec2, vec3, Fn, fract, length, smoothstep, uniform, uv } from 'three/tsl';
import { SCENE_LAYERS } from '../sceneLayers';

export interface GridPlaneOptions {
	density?: number;
	dotRadius?: number;
	dotSoftness?: number;
	dotColor?: THREE.Color;
	opacity?: number;
}

const DEFAULT_DENSITY = 120;
const DEFAULT_DOT_RADIUS = 0.04;
const DEFAULT_DOT_SOFTNESS = 0.015;
const DEFAULT_OPACITY = 0.015;
const DEFAULT_DOT_COLOR = '#ffffff';

export class GridPlane {
	public static readonly DEFAULTS = {
		density: DEFAULT_DENSITY,
		dotRadius: DEFAULT_DOT_RADIUS,
		dotSoftness: DEFAULT_DOT_SOFTNESS,
		dotColor: DEFAULT_DOT_COLOR,
		opacity: DEFAULT_OPACITY
	} as const;

	private readonly mesh: THREE.Mesh;
	private readonly material: THREE.MeshBasicNodeMaterial;
	private readonly aspectRatio: ReturnType<typeof uniform>;
	private readonly density: ReturnType<typeof uniform>;
	private readonly dotRadius: ReturnType<typeof uniform>;
	private readonly dotSoftness: ReturnType<typeof uniform>;
	private readonly dotColor: ReturnType<typeof uniform>;
	private readonly gridOpacity: ReturnType<typeof uniform>;
	private readonly tempDir = new THREE.Vector3();
	private readonly tempTarget = new THREE.Vector3();

	constructor(
		private readonly scene: THREE.Scene,
		viewportWidth: number,
		viewportHeight: number,
		options: GridPlaneOptions = {}
	) {
		const aspectRatio = uniform(viewportWidth / Math.max(1, viewportHeight));
		const density = uniform(options.density ?? DEFAULT_DENSITY);
		const dotRadius = uniform(options.dotRadius ?? DEFAULT_DOT_RADIUS);
		const dotSoftness = uniform(options.dotSoftness ?? DEFAULT_DOT_SOFTNESS);
		const dotColor = uniform(options.dotColor ?? new THREE.Color(DEFAULT_DOT_COLOR));
		const gridOpacity = uniform(options.opacity ?? DEFAULT_OPACITY);

		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.NormalBlending,
			visible: true
		});
		material.opacityNode = gridOpacity;
		material.colorNode = Fn(() => {
			const baseUv = uv();
			const scaledUv = baseUv.mul(vec2(density.mul(aspectRatio), density));
			const cellUv = fract(scaledUv);
			const centered = cellUv.sub(vec2(0.5, 0.5));
			const dist = length(centered);
			const dot = smoothstep(dotRadius.add(dotSoftness), dotRadius.sub(dotSoftness), dist);
			return vec3(dot, dot, dot).mul(dotColor);
		})();

		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspectRatio.value, 2), material);
		mesh.name = 'GridPlane';
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.scale.set(1.5, 1.5, 1.5);
		mesh.layers.disable(0);
		mesh.layers.enable(SCENE_LAYERS.SCENE_1);
		mesh.layers.enable(SCENE_LAYERS.SCENE_2);
		mesh.layers.enable(SCENE_LAYERS.SCENE_3);

		scene.add(mesh);

		this.mesh = mesh;
		this.material = material;
		this.aspectRatio = aspectRatio;
		this.density = density;
		this.dotRadius = dotRadius;
		this.dotSoftness = dotSoftness;
		this.dotColor = dotColor;
		this.gridOpacity = gridOpacity;
	}

	public getMesh(): THREE.Mesh {
		return this.mesh;
	}

	public setVisible(visible: boolean): void {
		this.mesh.visible = visible;
	}

	public setDensity(value: number): void {
		this.density.value = value;
	}

	public setDotRadius(value: number): void {
		this.dotRadius.value = value;
	}

	public setDotSoftness(value: number): void {
		this.dotSoftness.value = value;
	}

	public setDotColor(color: THREE.Color): void {
		(this.dotColor.value as THREE.Color).copy(color);
	}

	public setOpacity(value: number): void {
		this.gridOpacity.value = value;
	}

	/** Billboard the grid 2.5 units in front of the camera, facing it. */
	public faceCamera(camera: THREE.Camera): void {
		camera.getWorldDirection(this.tempDir);
		this.tempTarget.copy(this.tempDir).multiplyScalar(2.5).add(camera.position);
		this.mesh.position.copy(this.tempTarget);
		this.mesh.lookAt(camera.position);
	}

	public handleResize(width: number, height: number): void {
		const newAspect = width / Math.max(1, height);
		this.mesh.geometry.dispose();
		this.mesh.geometry = new THREE.PlaneGeometry(2 * newAspect, 2);
		this.aspectRatio.value = newAspect;
	}

	public dispose(): void {
		this.scene.remove(this.mesh);
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
