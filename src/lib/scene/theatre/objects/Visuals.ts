import * as THREE from 'three';
import type { Inspectable } from '../../debug/Inspectable';
import type Renderer from '../../postprocessing/Renderer';

/**
 * Theatre object for cross-cutting post-FX knobs that visibly affect every
 * rendered layer (post-FX composite, train slider, octagon particles, etc.):
 * bloom, chromatic aberration, vignette, and the emissive-source gain feeding
 * bloom.
 *
 * Writes go to the *authored* fields (`params.bloomStrength`,
 * `params.vignetteIntensityAuthored`, `params.chromeStrength`) and mirror those
 * values onto the live GPU uniforms immediately, so Theatre stays the single
 * source of truth without any per-frame re-sync.
 */
export class Visuals implements Inspectable {
	constructor(private renderer: Renderer) {}

	private vec3ToRgb(
		v: { x: number; y: number; z: number } | undefined,
		fallback: { r: number; g: number; b: number }
	): { r: number; g: number; b: number } {
		if (!v) return fallback;
		return { r: v.x, g: v.y, b: v.z };
	}

	private applyTint(target: any, tint: any): void {
		if (!target?.set || !tint) return;
		target.set(tint.r ?? 0, tint.g ?? 0, tint.b ?? 0);
	}

	/**
	 * One BloomNode per scene channel, each owning PRIVATE strength/radius/
	 * threshold uniforms (three's bloom() wraps its args in uniform()). Every
	 * write must fan out to all of them — writing only `bloomPass` (channel 1)
	 * leaves channels 2/3 frozen at their build-time values, which made Theatre
	 * bloom edits look dead on scenes 2/3. Read fresh from params on each call:
	 * a GPU-context recreate rebuilds the graph and replaces the array.
	 */
	private bloomPasses(p: any): any[] {
		return p.bloomPasses ?? (p.bloomPass ? [p.bloomPass] : []);
	}

	getConfig(): Record<string, any> {
		const refs = this.renderer.getRefs();
		const p = refs.params ?? {};
		return {
			bloom: {
				strength: p.bloomStrength ?? 0,
				radius: p.bloomPass?.radius?.value ?? p.bloomRadius ?? 0,
				threshold: p.bloomPass?.threshold?.value ?? p.bloomThreshold ?? 0,
				emissive: p.emissiveBloomIntensity?.value ?? 1,
				postFogEmissive: p.emissivePostFogIntensity?.value ?? 0.5
			},
			// `centerX/Y`, `exclusionRadius` and `exclusionFeather` define the SHARED
			// CA exclusion zone — they suppress both the radial CA pass and the
			// full-frame RGB split inside the same central disc (see caExclusion.js).
			chromatic: {
				strength: typeof p.chromeStrength === 'number' ? p.chromeStrength : 0,
				scale: typeof p.chromeScale === 'number' ? p.chromeScale : 0,
				centerX: p.staticCenter?.value?.x ?? 0.5,
				centerY: p.staticCenter?.value?.y ?? 0.5,
				exclusionRadius: p.chromeExclusionRadius?.value ?? 0,
				exclusionFeather: p.chromeExclusionFeather?.value ?? 0.16,
				splitMix: p.chromeSplitMix?.value ?? 0,
				// Shared CA breathing pulse (caBreathAmount/caBreathSpeed on the graph).
				// One pair of knobs drives BOTH the radial CA scale AND the RGB-split
				// offset, so a single track breathes every CA path (octagon + white-bg
				// pyramids). amount 0 freezes all CA; defaults reproduce the values the
				// radial CA previously hard-coded.
				breathingAmount: refs.caBreathAmount?.value ?? 0.5,
				breathingSpeed: refs.caBreathSpeed?.value ?? 1.3,
				redTint: this.vec3ToRgb(p.chromeRedTint?.value, { r: 1, g: 0, b: 0 }),
				greenTint: this.vec3ToRgb(p.chromeGreenTint?.value, { r: 0, g: 0, b: 0 }),
				blueTint: this.vec3ToRgb(p.chromeBlueTint?.value, { r: 0, g: 0, b: 1 })
			},
			// Flattens to `vignetteIntensity` / `vignetteWidth` / `vignetteRoundness`
			// / `vignetteCenter` / `vignetteColor` Theatre props on the
			// `PostProcessing` object. `width` is the fade-band thickness (the gap
			// between inner/outer edge); `center` positions that band radially.
			vignette: {
				intensity: p.vignetteIntensityAuthored ?? refs.vignetteIntensity?.value ?? 0,
				width: refs.vignetteWidth?.value ?? 0.187,
				roundness: refs.vignetteRoundness?.value ?? 0,
				center: refs.vignetteCenter?.value ?? 0.5,
				color: this.vec3ToRgb(refs.vignetteColor?.value, { r: 0, g: 0, b: 0 })
			},
			// Flattens to `fisheyeStrength` / `fisheyeBarrel` / `fisheyeAberration`
			// Theatre props. `strength` is the main animated knob in the default
			// JSON; barrel/aberration are static overrides per-platform.
			fisheye: {
				strength: refs.fisheyeStrength?.value ?? 0,
				barrel: refs.fisheyeBarrel?.value ?? 0.5,
				aberration: refs.fisheyeAberration?.value ?? 0.015
			},
			// Full-frame RGB channel split (RGBSplitNode). `strength` is the
			// timeline-driven master blend (0 outside the pyramid window);
			// `offset`/`radial` are look constants.
			rgbSplit: {
				strength: refs.rgbSplitStrength?.value ?? 0,
				offset: refs.rgbSplitOffset?.value ?? 0.004,
				radial: refs.rgbSplitRadial?.value ?? 0.15,
				// Green channel displacement as a fraction of the red/blue offset. 0
				// keeps green stationary (its tint inert); raise it to give greenTint a
				// visible fringe. See RGBSplitNode / guessRange('rgbsplitgreenoffset').
				greenOffset: refs.rgbSplitGreenOffset?.value ?? 0
			}
		};
	}

	applyConfig(config: Record<string, any>): void {
		const refs = this.renderer.getRefs();
		const p = refs.params;
		if (!p) return;

		const bloom = config.bloom;
		if (bloom) {
			const bloomPasses = this.bloomPasses(p);
			if (typeof bloom.strength === 'number') {
				p.bloomStrength = bloom.strength;
				for (const pass of bloomPasses) pass.strength.value = bloom.strength;
			}
			if (typeof bloom.radius === 'number') {
				p.bloomRadius = bloom.radius;
			}
			if (typeof bloom.threshold === 'number') {
				p.bloomThreshold = bloom.threshold;
			}
			for (const pass of bloomPasses) {
				if (typeof bloom.radius === 'number') pass.radius.value = bloom.radius;
				if (typeof bloom.threshold === 'number') pass.threshold.value = bloom.threshold;
			}
			if (typeof bloom.emissive === 'number' && p.emissiveBloomIntensity) {
				p.emissiveBloomIntensity.value = bloom.emissive;
			}
			if (typeof bloom.postFogEmissive === 'number' && p.emissivePostFogIntensity) {
				p.emissivePostFogIntensity.value = bloom.postFogEmissive;
			}
		}

		const chromatic = config.chromatic;
		if (chromatic) {
			if (typeof chromatic.strength === 'number') {
				p.chromeStrength = chromatic.strength;
				if (p.staticStrength) p.staticStrength.value = chromatic.strength;
			}
			if (typeof chromatic.scale === 'number') {
				p.chromeScale = chromatic.scale;
				if (p.staticScale) p.staticScale.value = chromatic.scale;
			}
			if (p.staticCenter?.value) {
				if (typeof chromatic.centerX === 'number') p.staticCenter.value.x = chromatic.centerX;
				if (typeof chromatic.centerY === 'number') p.staticCenter.value.y = chromatic.centerY;
			}
			if (typeof chromatic.exclusionRadius === 'number' && p.chromeExclusionRadius) {
				p.chromeExclusionRadius.value = chromatic.exclusionRadius;
			}
			if (typeof chromatic.exclusionFeather === 'number' && p.chromeExclusionFeather) {
				p.chromeExclusionFeather.value = chromatic.exclusionFeather;
			}
			if (typeof chromatic.splitMix === 'number' && p.chromeSplitMix) {
				p.chromeSplitMix.value = chromatic.splitMix;
			}
			if (typeof chromatic.breathingAmount === 'number' && refs.caBreathAmount) {
				refs.caBreathAmount.value = chromatic.breathingAmount;
			}
			if (typeof chromatic.breathingSpeed === 'number' && refs.caBreathSpeed) {
				refs.caBreathSpeed.value = chromatic.breathingSpeed;
			}
			this.applyTint(p.chromeRedTint?.value, chromatic.redTint);
			this.applyTint(p.chromeGreenTint?.value, chromatic.greenTint);
			this.applyTint(p.chromeBlueTint?.value, chromatic.blueTint);
		}

		const vignette = config.vignette;
		if (vignette) {
			if (typeof vignette.intensity === 'number') {
				p.vignetteIntensityAuthored = vignette.intensity;
				if (refs.vignetteIntensity) refs.vignetteIntensity.value = vignette.intensity;
			}
			if (typeof vignette.width === 'number' && refs.vignetteWidth) {
				refs.vignetteWidth.value = vignette.width;
			}
			if (typeof vignette.roundness === 'number' && refs.vignetteRoundness) {
				refs.vignetteRoundness.value = vignette.roundness;
			}
			if (typeof vignette.center === 'number' && refs.vignetteCenter) {
				refs.vignetteCenter.value = vignette.center;
			}
			this.applyTint(refs.vignetteColor?.value, vignette.color);
		}

		const fisheye = config.fisheye;
		if (fisheye) {
			if (typeof fisheye.strength === 'number' && refs.fisheyeStrength) {
				refs.fisheyeStrength.value = fisheye.strength;
			}
			if (typeof fisheye.barrel === 'number' && refs.fisheyeBarrel) {
				refs.fisheyeBarrel.value = fisheye.barrel;
			}
			if (typeof fisheye.aberration === 'number' && refs.fisheyeAberration) {
				refs.fisheyeAberration.value = fisheye.aberration;
			}
		}

		const rgbSplit = config.rgbSplit;
		if (rgbSplit) {
			if (typeof rgbSplit.strength === 'number' && refs.rgbSplitStrength) {
				refs.rgbSplitStrength.value = rgbSplit.strength;
			}
			if (typeof rgbSplit.offset === 'number' && refs.rgbSplitOffset) {
				refs.rgbSplitOffset.value = rgbSplit.offset;
			}
			if (typeof rgbSplit.radial === 'number' && refs.rgbSplitRadial) {
				refs.rgbSplitRadial.value = rgbSplit.radial;
			}
			if (typeof rgbSplit.greenOffset === 'number' && refs.rgbSplitGreenOffset) {
				refs.rgbSplitGreenOffset.value = rgbSplit.greenOffset;
			}
		}
	}

	setupInspectorControls(inspectorInstance: any): any {
		const refs = this.renderer.getRefs();
		const p = refs.params ?? {};

		// Attach Bloom / Chromatic Aberration / Vignette to Renderer's
		// existing `Post Processing` panel so all post-FX knobs live in
		// one folder. Fall back to a standalone panel if the renderer panel
		// isn't available (e.g. inspector ran in a non-standard order).
		const ownsPanel = !this.renderer.getPostProcessingPanel();
		const gui =
			this.renderer.getPostProcessingPanel() ??
			inspectorInstance.createParameters('Post Processing');
		if (ownsPanel) gui.close();

		const bloomFolder = gui.addFolder('Bloom');
		if (p.emissiveBloomIntensity) {
			bloomFolder.add(p.emissiveBloomIntensity, 'value', 0, 8, 0.01).name('Emissive Source Gain');
		}
		if (p.emissivePostFogIntensity) {
			// How much of each scene's emissive surface gets re-added on top of
			// DaoFog so it punches through atmospheric fog. 0 = legacy "fog
			// dims emissive"; >1 over-brightens emissive in un-fogged regions.
			bloomFolder.add(p.emissivePostFogIntensity, 'value', 0, 2, 0.01).name('Emissive Through Fog');
		}
		if (p.bloomPass) {
			bloomFolder.add(p, 'bloomStrength', 0, 5, 0.01).onChange((v: number) => {
				for (const pass of this.bloomPasses(p)) pass.strength.value = v;
			});
			bloomFolder.add(p, 'bloomRadius', 0, 5, 0.01).onChange((v: number) => {
				p.bloomRadius = v;
				for (const pass of this.bloomPasses(p)) pass.radius.value = v;
			});
			bloomFolder.add(p, 'bloomThreshold', 0, 2, 0.001).onChange((v: number) => {
				p.bloomThreshold = v;
				for (const pass of this.bloomPasses(p)) pass.threshold.value = v;
			});
		}

		const chromeFolder = gui.addFolder('Chromatic Aberration');
		// Shared exclusion zone center in UV (0.5,0.5 = screen center). Drives both
		// the radial CA pass and the RGB split, and is the radial CA's origin.
		if (p.staticCenter?.value) {
			chromeFolder.add(p.staticCenter.value, 'x', 0, 1, 0.001).name('exclusion center x');
			chromeFolder.add(p.staticCenter.value, 'y', 0, 1, 0.001).name('exclusion center y');
		}
		if (p.staticStrength && typeof p.chromeStrength === 'number') {
			chromeFolder
				.add(p, 'chromeStrength', 0, 100)
				.name('strength')
				.onChange((v: number) => {
					p.staticStrength.value = v;
				});
		}
		if (p.staticScale) {
			chromeFolder.add(p.staticScale, 'value', 0, 2).name('scale');
		}
		if (p.chromeExclusionRadius) {
			chromeFolder.add(p.chromeExclusionRadius, 'value', 0, 1, 0.001).name('exclusion radius');
		}
		if (p.chromeExclusionFeather) {
			chromeFolder.add(p.chromeExclusionFeather, 'value', 0, 1, 0.001).name('exclusion feather');
		}
		if (p.chromeSplitMix) {
			chromeFolder.add(p.chromeSplitMix, 'value', 0, 1, 0.001).name('split mix');
		}
		// Shared CA breathing pulse — drives both the radial CA scale and the RGB
		// split offset (white-bg pyramids), so one knob breathes every CA path.
		if (refs.caBreathAmount) {
			chromeFolder.add(refs.caBreathAmount, 'value', 0, 2, 0.01).name('breathing amount');
		}
		if (refs.caBreathSpeed) {
			chromeFolder.add(refs.caBreathSpeed, 'value', 0, 5, 0.01).name('breathing speed');
		}

		const splitFolder = gui.addFolder('RGB Split');
		if (refs.rgbSplitStrength) {
			splitFolder.add(refs.rgbSplitStrength, 'value', 0, 1, 0.001).name('strength');
		}
		if (refs.rgbSplitOffset) {
			splitFolder.add(refs.rgbSplitOffset, 'value', 0, 0.03, 0.0005).name('offset');
		}
		if (refs.rgbSplitRadial) {
			splitFolder.add(refs.rgbSplitRadial, 'value', 0, 1, 0.01).name('radial');
		}
		if (refs.rgbSplitGreenOffset) {
			splitFolder.add(refs.rgbSplitGreenOffset, 'value', 0, 1, 0.01).name('green offset');
		}

		const vignetteFolder = gui.addFolder('Vignette');
		if (refs.vignetteIntensity) {
			const debugObject = {
				intensity: p.vignetteIntensityAuthored ?? refs.vignetteIntensity.value,
				width: refs.vignetteWidth?.value ?? 0.187,
				roundness: refs.vignetteRoundness.value,
				center: refs.vignetteCenter?.value ?? 0.5,
				color:
					'#' +
					new THREE.Color(
						refs.vignetteColor.value.x,
						refs.vignetteColor.value.y,
						refs.vignetteColor.value.z
					).getHexString()
			};
			vignetteFolder
				.add(debugObject, 'intensity', 0, 100)
				.name('Intensity')
				.onChange((value: number) => {
					refs.vignetteIntensity.value = value;
					p.vignetteIntensityAuthored = value;
				});
			vignetteFolder
				.add(debugObject, 'width', 0, 2)
				.name('Width')
				.onChange((value: number) => {
					if (refs.vignetteWidth) refs.vignetteWidth.value = value;
				});
			vignetteFolder
				.add(debugObject, 'roundness', 0, 2)
				.name('Roundness')
				.onChange((value: number) => {
					refs.vignetteRoundness.value = value;
				});
			vignetteFolder
				.add(debugObject, 'center', 0, 1)
				.name('Center')
				.onChange((value: number) => {
					if (refs.vignetteCenter) refs.vignetteCenter.value = value;
				});
			vignetteFolder.addColor(debugObject, 'color').onChange((v: string) => {
				const c = new THREE.Color(v);
				refs.vignetteColor.value.set(c.r, c.g, c.b);
			});
		}

		return gui;
	}
}

export default Visuals;
