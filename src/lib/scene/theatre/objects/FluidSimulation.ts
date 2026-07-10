import * as THREE from 'three';
import type { Inspectable } from '../../debug/Inspectable';
import type { FluidMouseField } from '../../particles/FluidMouseField';
import { FluidProfiles, OCTAGON_SPLAT_RADIUS_RATIO } from '../../particles/FluidMouseField';
import type Renderer from '../../postprocessing/Renderer';

/**
 * Theatre object owning the GPGPU fluid solver knobs (splat / curl /
 * dissipation + Jacobi iteration count) plus the post-FX side that consumes
 * the velocity field (distortion strength, color amount, color tint).
 *
 * Centralising these prevents the same knobs being duplicated in the per-system
 * inspector folders (octagon, train slider) — there is one fluid simulation in
 * the scene, so its parameters live in one Theatre object.
 */
export class FluidSimulation implements Inspectable {
	constructor(
		private fluidField: FluidMouseField | null,
		private renderer: Renderer
	) {}

	getConfig(): Record<string, any> {
		const refs = this.renderer.getRefs();
		const f = this.fluidField;
		const tint = refs.fluidColorTint?.value;
		return {
			sim: {
				// PostFx (distortion) radius is the master value; the particle splat
				// rides at OCTAGON_SPLAT_RADIUS_RATIO of it. Read the profile, not the
				// inert field-level uSplatRadius, so the control round-trips.
				splatRadius: FluidProfiles.PostFx.radius,
				splatForce: f?.uSplatForce?.value ?? 3000,
				curlStrength: f?.uCurlStrength?.value ?? 0,
				velocityDissipation: f?.uVelocityDissipation?.value ?? 1,
				pressureDissipation: f?.uPressureDissipation?.value ?? 1,
				pressureIterations: f?.pressureIterations ?? 12
			},
			distortion: {
				strength: refs.fluidDistortionStrength?.value ?? 0,
				colorAmount: refs.fluidColorAmount?.value ?? 0,
				tintR: tint?.x ?? 1,
				tintG: tint?.y ?? 1,
				tintB: tint?.z ?? 1
			}
		};
	}

	applyConfig(config: Record<string, any>): void {
		const f = this.fluidField;
		const refs = this.renderer.getRefs();

		const sim = config.sim;
		if (sim && f) {
			if (typeof sim.splatRadius === 'number') {
				// One knob scales both splats: distortion gets the value directly, the
				// octagon particle splat tracks at half (the reference 2:1 ratio).
				FluidProfiles.PostFx.radius = sim.splatRadius;
				FluidProfiles.OctagonParticles.radius = sim.splatRadius * OCTAGON_SPLAT_RADIUS_RATIO;
				// Keep the field-level fallback (used by profile-less warmup splats) coherent.
				f.uSplatRadius.value = sim.splatRadius;
			}
			if (typeof sim.splatForce === 'number') f.uSplatForce.value = sim.splatForce;
			if (typeof sim.curlStrength === 'number') f.uCurlStrength.value = sim.curlStrength;
			if (typeof sim.velocityDissipation === 'number') {
				f.uVelocityDissipation.value = sim.velocityDissipation;
			}
			if (typeof sim.pressureDissipation === 'number') {
				f.uPressureDissipation.value = sim.pressureDissipation;
			}
			if (typeof sim.pressureIterations === 'number') {
				f.pressureIterations = Math.max(1, Math.round(sim.pressureIterations));
			}
		}

		const dist = config.distortion;
		if (dist) {
			if (typeof dist.strength === 'number' && refs.fluidDistortionStrength) {
				refs.fluidDistortionStrength.value = dist.strength;
			}
			if (typeof dist.colorAmount === 'number' && refs.fluidColorAmount) {
				refs.fluidColorAmount.value = dist.colorAmount;
			}
			const tint = refs.fluidColorTint?.value;
			if (tint) {
				if (typeof dist.tintR === 'number') tint.x = dist.tintR;
				if (typeof dist.tintG === 'number') tint.y = dist.tintG;
				if (typeof dist.tintB === 'number') tint.z = dist.tintB;
			}
		}
	}

	setupInspectorControls(inspectorInstance: any): any {
		const refs = this.renderer.getRefs();
		const f = this.fluidField;

		const gui = inspectorInstance.createParameters('Fluid Simulation');
		gui.close();

		const simFolder = gui.addFolder('Sim');
		if (f) {
			// Drives both splats (distortion + octagon particles) via the profiles;
			// binding to f.uSplatRadius directly would be inert. See FluidProfiles.
			const splatRadiusState = { value: FluidProfiles.PostFx.radius };
			simFolder
				.add(splatRadiusState, 'value', 0.001, 0.5, 0.001)
				.name('Splat Radius')
				.onChange((v: number) => {
					FluidProfiles.PostFx.radius = v;
					FluidProfiles.OctagonParticles.radius = v * OCTAGON_SPLAT_RADIUS_RATIO;
					f.uSplatRadius.value = v;
				});
			simFolder.add(f.uSplatForce, 'value', 1, 6000, 10).name('Splat Force');
			simFolder.add(f.uCurlStrength, 'value', 0, 60, 0.5).name('Curl Strength');
			simFolder.add(f.uVelocityDissipation, 'value', 0, 5, 0.05).name('Velocity Dissipation');
			simFolder.add(f.uPressureDissipation, 'value', 0.5, 1, 0.001).name('Pressure Dissipation');
			simFolder.add(f, 'pressureIterations', 1, 30, 1).name('Pressure Iterations');
		}

		const distortionFolder = gui.addFolder('Distortion');
		if (refs.fluidActive) {
			distortionFolder.add(refs.fluidActive, 'value', 0, 1, 0.01).name('Active');
		}
		if (refs.fluidDistortionStrength) {
			distortionFolder
				.add(refs.fluidDistortionStrength, 'value', 0, 4, 0.01)
				.name('Distortion Strength');
		}
		if (refs.fluidColorAmount) {
			distortionFolder.add(refs.fluidColorAmount, 'value', 0, 1, 0.01).name('Color Amount');
		}
		if (refs.fluidColorTint?.value) {
			const tintState = {
				color:
					'#' +
					new THREE.Color(
						refs.fluidColorTint.value.x,
						refs.fluidColorTint.value.y,
						refs.fluidColorTint.value.z
					).getHexString()
			};
			distortionFolder
				.addColor(tintState, 'color')
				.name('Effect Color')
				.onChange((v: string) => {
					const c = new THREE.Color(v);
					refs.fluidColorTint.value.set(c.r, c.g, c.b);
				});
		}
		if (refs.fluidDebug) {
			const debugView = { mode: refs.fluidDebug.value };
			const debugOptions = { Off: 0, Velocity: 1, Glass: 2, Overlay: 3 };
			distortionFolder
				.add(debugView, 'mode', debugOptions)
				.name('Debug View')
				.onChange((value: number) => {
					refs.fluidDebug.value = Number(value);
				});
		}

		return gui;
	}
}

export default FluidSimulation;
