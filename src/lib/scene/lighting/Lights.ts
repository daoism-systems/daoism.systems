import * as THREE from 'three';
import { SCENE_LAYERS } from '../sceneLayers';
import type { Inspectable } from '../debug/Inspectable';
import { detectMob } from '$lib/utils/isMobile';

export class Lights implements Inspectable {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera | null;
	private ambientLight!: THREE.AmbientLight;
	private spotLight!: THREE.SpotLight;

	// Pre-allocated to avoid per-frame heap allocations in updateLightPositions().
	private readonly _cameraPos = new THREE.Vector3();

	// Main spot is a camera-tracked "headlight": fixed world X/Z, Y follows the
	// camera, aimed at the camera's position. Restored from the pre-May-29 rig
	// (commit 086d877/c1825c9 disabled then deleted it). The forest/tree meshes
	// have no env map, so this spot is their only specular / reflection source.
	private readonly spotLightOffset = new THREE.Vector3(4.26, 3.68, -5.96);

	constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera | null = null) {
		this.scene = scene;
		this.camera = camera;
	}

	public setupLights(): void {
		this.ambientLight = new THREE.AmbientLight('#fff', 0);
		this.scene.add(this.ambientLight);

		const isMobile = detectMob();

		this.spotLight = new THREE.SpotLight(new THREE.Color('#fff'), 10);
		this.spotLight.angle = 0.35;
		this.spotLight.penumbra = 0.14;
		this.spotLight.decay = 2.05;
		this.spotLight.distance = isMobile ? 20 : 40;
		this.spotLight.castShadow = true;
		this.spotLight.shadow.intensity = 0.68;
		this.spotLight.shadow.mapSize.width = isMobile ? 128 : 512;
		this.spotLight.shadow.mapSize.height = isMobile ? 128 : 512;
		this.spotLight.shadow.camera.near = 1;
		this.spotLight.shadow.camera.far = 100;
		this.spotLight.shadow.focus = 1.084;
		this.spotLight.shadow.bias = 0.0071;

		// Lights have to be enabled on every scene channel they should illuminate,
		// otherwise `pass.setLayers(SCENE_X)` excludes them.
		const sceneChannels = [SCENE_LAYERS.SCENE_1, SCENE_LAYERS.SCENE_2, SCENE_LAYERS.SCENE_3];
		for (const channel of sceneChannels) {
			this.ambientLight.layers.enable(channel);
			this.spotLight.layers.enable(channel);
		}

		this.scene.add(this.spotLight);
		this.scene.add(this.spotLight.target);

		this.updateLightPositions();
	}

	/** Per-frame: keep the headlight at the camera's height, aimed where it looks. */
	public updateLightPositions(): void {
		if (!this.camera || !this.spotLight) return;
		this._cameraPos.copy(this.camera.position);
		this.spotLight.position.set(
			this.spotLightOffset.x,
			this._cameraPos.y + this.spotLightOffset.y,
			this.spotLightOffset.z
		);
		this.spotLight.target.position.copy(this._cameraPos);
	}

	public dispose(): void {
		if (this.ambientLight) {
			this.scene.remove(this.ambientLight);
			this.ambientLight.dispose();
		}
		if (this.spotLight) {
			this.scene.remove(this.spotLight);
			this.scene.remove(this.spotLight.target);
			this.spotLight.dispose();
		}
	}

	// ── Theatre.js Inspectable ────────────────────────────────────────

	getConfig(): Record<string, any> {
		return {
			ambientLight: {
				color: this.ambientLight?.color.getHex() ?? 0xffffff,
				intensity: this.ambientLight?.intensity ?? 0
			}
		};
	}

	getLabels(): Record<string, string> {
		return {
			ambientLightColor: 'amb color',
			ambientLightIntensity: 'amb power'
		};
	}

	applyConfig(config: Record<string, any>): void {
		const c = config.ambientLight;
		if (!this.ambientLight || !c) return;
		if (typeof c.color === 'number') this.ambientLight.color.setHex(c.color);
		if (typeof c.intensity === 'number') this.ambientLight.intensity = c.intensity;
	}

	public setupInspectorControls(inspectorInstance: any): any {
		const gui = inspectorInstance.createParameters('Lighting / Scene');
		gui.close();

		const ambientFolder = gui.addFolder('Ambient Light');
		ambientFolder.add(this.ambientLight, 'intensity', 0, 300).name('light intensity');
		ambientFolder.addColor(this.ambientLight, 'color').name('light color');

		const spotFolder = gui.addFolder('Main Spot');
		spotFolder.add(this.spotLight, 'intensity', 0, 100).name('intensity');
		spotFolder.add(this.spotLight, 'angle', 0, 1.57, 0.01).name('angle');
		spotFolder.add(this.spotLight, 'penumbra', 0, 1, 0.01).name('penumbra');
		spotFolder.add(this.spotLight, 'distance', 0, 100).name('distance');

		return gui;
	}
}

export default Lights;
