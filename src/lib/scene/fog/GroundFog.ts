import * as THREE from 'three/webgpu';
import {
	Fn,
	uniform,
	float,
	vec4,
	output,
	positionWorld,
	positionView,
	time,
	clamp,
	pow,
	max,
	triNoise3D,
	mx_noise_float,
	densityFogFactor
} from 'three/tsl';
import type { Inspectable } from '../debug/Inspectable';

/**
 * World-space reference (from DAO.glb gltf-transform inspection):
 *
 *   Forest root        Y = -19.25
 *   City buildings      Y ~ -18.5  to -17.7
 *   Ground plane mesh   Y ~ -33.6  to  -5.9  (large, extends well below city)
 *   Trees              Y ~ -33    to -11
 *   Camera (Scene_07)   Y ~ -18    to -19
 *
 * Ground fog should sit below the camera, filling the gaps between
 * buildings/trees and fading out above the city rooftops.
 */
export class GroundFog implements Inspectable {
	// Uniforms — defaults tuned to the Scene_07 (forest/city) world-space layout
	readonly opacity = uniform(0);
	readonly fogColor = uniform(new THREE.Color(0xffffff));
	readonly fogBaseY = uniform(-20.5); // Y of densest fog (below city floor)
	readonly fogHeight = uniform(1.5); // height band above fogBaseY where fog fades to 0
	readonly fogAlpha = uniform(0.28); // peak density
	readonly fogPower = uniform(10); // height falloff exponent
	readonly noiseScale = uniform(2.5); // noise sampling frequency multiplier
	readonly animSpeed = uniform(1.0); // noise animation speed
	readonly baseDensity = uniform(0.007); // exponential fog density (replaces FogExp2)
	readonly distanceFade = uniform(15); // distance (view-space) over which ground fog ramps up

	private scene: THREE.Scene;
	private isSafari: boolean;
	// Theatre / inspector write here via `applyConfig` / `setOpacity`, both of
	// which mirror the value onto the live `opacity` uniform directly.
	private authoredOpacity = 0;

	constructor(scene: THREE.Scene, isSafari: boolean = false) {
		this.scene = scene;
		this.isSafari = isSafari;
	}

	getAuthoredOpacity(): number {
		return this.authoredOpacity;
	}

	/**
	 * Build the TSL fog node graph and assign it to scene.fogNode.
	 * The node blends exponential distance fog with a height-based ground fog
	 * that uses triNoise3D for animated noise.
	 *
	 * At opacity=0 the result is identical to FogExp2(baseDensity).
	 */
	enable(): void {
		const {
			opacity,
			fogColor,
			fogBaseY,
			fogHeight,
			fogAlpha,
			fogPower,
			noiseScale,
			animSpeed,
			baseDensity,
			distanceFade
		} = this;

		const fogNode = Fn(() => {
			// --- Exponential distance fog (replicates FogExp2) ---
			const expFactor = densityFogFactor(baseDensity);

			// --- Height-based ground fog ---
			// How far above fogBaseY is this fragment? 0 at base, 1 at top of fog band
			const heightAboveBase = positionWorld.y.sub(fogBaseY);
			const heightRatio = clamp(heightAboveBase.div(fogHeight), 0, 1);
			// Density: 1 at base, falls to 0 at fogBaseY + fogHeight
			const heightFade = float(1).sub(pow(heightRatio, fogPower));

			// Distance fade — ramp ground fog over a configurable distance
			const dist = positionView.z.negate(); // positive distance from camera
			const distFade = clamp(dist.div(distanceFade), 0, 1);

			// Animated noise
			const noisePos = positionWorld.mul(noiseScale.mul(0.05));
			const speed = animSpeed.mul(0.3);
			// Safari: single-octave Perlin noise (~3x cheaper than triNoise3D's 4-iteration loop)
			const noise = this.isSafari
				? mx_noise_float(noisePos.add(time.mul(speed.mul(0.1))))
						.add(0.5)
						.clamp(0, 1)
				: triNoise3D(noisePos, speed, time);

			// Combine ground fog components
			const groundFogDensity = heightFade.mul(distFade).mul(noise).mul(fogAlpha);

			// Final factor: blend between pure exp fog and exp+ground fog using opacity
			const combinedFactor = max(expFactor, expFactor.add(groundFogDensity.mul(opacity)));
			const finalFactor = clamp(combinedFactor, 0, 1);

			return vec4(finalFactor.toFloat().mix(output.rgb, fogColor.toVec3()), output.a);
		})();

		this.scene.fogNode = fogNode;
	}

	setOpacity(v: number): void {
		this.authoredOpacity = v;
		this.opacity.value = v;
	}

	// ── Theatre.js Inspectable ────────────────────────────────────────

	getConfig(): Record<string, any> {
		const c = this.fogColor.value;
		return {
			opacity: this.authoredOpacity,
			fogColor: { r: c.r, g: c.g, b: c.b },
			fogBaseY: this.fogBaseY.value,
			fogHeight: this.fogHeight.value,
			fogAlpha: this.fogAlpha.value,
			fogPower: this.fogPower.value,
			noiseScale: this.noiseScale.value,
			animSpeed: this.animSpeed.value,
			baseDensity: this.baseDensity.value,
			distanceFade: this.distanceFade.value
		};
	}

	applyConfig(config: Record<string, any>): void {
		if (typeof config.opacity === 'number') {
			this.authoredOpacity = config.opacity;
			this.opacity.value = config.opacity;
		}
		if (typeof config.fogBaseY === 'number') this.fogBaseY.value = config.fogBaseY;
		if (typeof config.fogHeight === 'number') this.fogHeight.value = config.fogHeight;
		if (typeof config.fogAlpha === 'number') this.fogAlpha.value = config.fogAlpha;
		if (typeof config.fogPower === 'number') this.fogPower.value = config.fogPower;
		if (typeof config.noiseScale === 'number') this.noiseScale.value = config.noiseScale;
		if (typeof config.animSpeed === 'number') this.animSpeed.value = config.animSpeed;
		if (typeof config.baseDensity === 'number') this.baseDensity.value = config.baseDensity;
		if (typeof config.distanceFade === 'number') this.distanceFade.value = config.distanceFade;
		const c = config.fogColor;
		if (c && typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
			this.fogColor.value.setRGB(c.r, c.g, c.b);
		}
	}

	getRefs() {
		return {
			opacity: this.opacity,
			fogColor: this.fogColor,
			fogBaseY: this.fogBaseY,
			fogHeight: this.fogHeight,
			fogAlpha: this.fogAlpha,
			fogPower: this.fogPower,
			noiseScale: this.noiseScale,
			animSpeed: this.animSpeed,
			baseDensity: this.baseDensity,
			distanceFade: this.distanceFade
		};
	}

	setupInspectorControls(inspectorInstance: any): any {
		const gui = inspectorInstance.createParameters('Ground Fog');
		gui.close();

		const debugObject = {
			opacity: this.authoredOpacity
		};
		gui
			.add(debugObject, 'opacity', 0, 1, 0.01)
			.name('Opacity')
			.onChange((value: number) => {
				this.setOpacity(value);
			});
		gui.add(this.baseDensity, 'value', 0, 0.2, 0.001).name('Base Density');
		gui.add(this.fogBaseY, 'value', -40, 0, 0.5).name('Fog Base Y');
		gui.add(this.fogHeight, 'value', 0.5, 20, 0.25).name('Fog Height');
		gui.add(this.fogAlpha, 'value', 0, 1, 0.01).name('Peak Density');
		gui.add(this.fogPower, 'value', 0.5, 10, 0.1).name('Height Falloff');
		gui.add(this.distanceFade, 'value', 1, 80, 0.5).name('Distance Fade');
		gui.add(this.noiseScale, 'value', 0.1, 5, 0.01).name('Noise Scale');
		gui.add(this.animSpeed, 'value', 0, 5, 0.1).name('Anim Speed');

		const colorObj = {
			color:
				'#' +
				new THREE.Color(
					this.fogColor.value.r,
					this.fogColor.value.g,
					this.fogColor.value.b
				).getHexString()
		};
		gui
			.addColor(colorObj, 'color')
			.name('Fog Color')
			.onChange((v: string) => {
				const c = new THREE.Color(v);
				this.fogColor.value.setRGB(c.r, c.g, c.b);
			});

		return gui;
	}

	dispose(): void {
		(this.scene as any).fogNode = null;
	}
}
