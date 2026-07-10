import type { Inspectable } from '../../debug/Inspectable';
import type Renderer from '../../postprocessing/Renderer';
import type { TransitionLookParams } from '../../postprocessing/Renderer';
import type { TransitionPairId } from '../../postprocessing/types';
import { CLOUD_FILL_AUTHORED_EPSILON, CLOUD_TRANSITION_FILL } from '../../animation/sceneUiTiming';

/**
 * Theatre object for the scene-to-scene transition.
 *
 * - `timing` exposes the four scroll-position windows that bound the transition
 *   cross-fade (`fillInStart..fillInEnd`, `fadeOutStart..fadeOutEnd`).
 *
 * - `procedural` / `swarm` are the two independent shader-uniform sets. Each
 *   transition pair (1→2 = procedural, 2→3 = swarm) owns its own set so edits
 *   to one don't bleed into the other. AnimationController flips which pair is
 *   active via `renderer.setActiveTransitionPair(pair)`.
 */

import {
	TRANSITION_LOOK_PROCEDURAL,
	TRANSITION_LOOK_SWARM
} from '../../postprocessing/transitionLooks';

const cloneLook = (look: TransitionLookParams): TransitionLookParams => ({ ...look });

const readLook = (
	source: Record<string, any> | undefined,
	fallback: TransitionLookParams
): TransitionLookParams => {
	if (!source) return cloneLook(fallback);
	const pick = (key: keyof TransitionLookParams): number =>
		typeof source[key] === 'number' ? source[key] : fallback[key];
	const axis = pick('axisIndex');
	return {
		smearStrength: pick('smearStrength'),
		caStrength: pick('caStrength'),
		maskSoftness: pick('maskSoftness'),
		axisIndex: axis >= 0.5 ? 1 : 0,
		noiseScaleX: pick('noiseScaleX'),
		noiseScaleY: pick('noiseScaleY'),
		noiseScrollSpeed: pick('noiseScrollSpeed'),
		maskNoiseStrength: pick('maskNoiseStrength'),
		detailNoiseAmount: pick('detailNoiseAmount'),
		radialStrength: pick('radialStrength'),
		radialOriginX: pick('radialOriginX'),
		radialOriginY: pick('radialOriginY'),
		radialRadius: pick('radialRadius'),
		radialSpreadX: pick('radialSpreadX'),
		pixelStrength: pick('pixelStrength'),
		pixelBlockSize: pick('pixelBlockSize'),
		pixelGlitchAmount: pick('pixelGlitchAmount')
	};
};

type LookState = Record<TransitionPairId, TransitionLookParams>;

export class Transition implements Inspectable {
	private looks: LookState = {
		procedural: cloneLook(TRANSITION_LOOK_PROCEDURAL),
		swarm: cloneLook(TRANSITION_LOOK_SWARM)
	};

	constructor(private renderer: Renderer) {
		// Seed both pairs so the first transition has the correct look even
		// if Theatre's applyConfig hasn't fired yet.
		this.pushLookToRenderer('procedural');
		this.pushLookToRenderer('swarm');
	}

	getConfig(): Record<string, any> {
		return {
			fill: {
				oneToTwo: CLOUD_TRANSITION_FILL.oneToTwo,
				twoToThree: CLOUD_TRANSITION_FILL.twoToThree
			},
			procedural: cloneLook(this.looks.procedural),
			swarm: cloneLook(this.looks.swarm)
		};
	}

	getLabels(): Record<string, string> {
		// Two keyframed 0→1 sweep ramps — keyframe POSITION = when the wipe fires,
		// value = sweep amount. fillOneToTwo = the procedural 1→2 wipe,
		// fillTwoToThree = the swarm 2→3 wipe.
		return {
			fillOneToTwo: '1→2 wipe',
			fillTwoToThree: '2→3 wipe'
		};
	}

	applyConfig(config: Record<string, any>): void {
		// Live 0→1 sweep values, interpolated by Theatre at the current scroll
		// position from the keyframed tracks. Mirrored into CLOUD_TRANSITION_FILL,
		// which the cross-fade + stage router read each tick. A wipe flips to
		// value-driven the first time its track actually drives the value above ~0
		// (lazy authored-detection — see CLOUD_TRANSITION_FILL); until then it
		// stays on the threshold fallback, so a missing/dropped track is harmless.
		const fill = config.fill;
		if (fill) {
			if (typeof fill.oneToTwo === 'number') {
				CLOUD_TRANSITION_FILL.oneToTwo = fill.oneToTwo;
				if (fill.oneToTwo > CLOUD_FILL_AUTHORED_EPSILON) {
					CLOUD_TRANSITION_FILL.authoredOneToTwo = true;
				}
			}
			if (typeof fill.twoToThree === 'number') {
				CLOUD_TRANSITION_FILL.twoToThree = fill.twoToThree;
				if (fill.twoToThree > CLOUD_FILL_AUTHORED_EPSILON) {
					CLOUD_TRANSITION_FILL.authoredTwoToThree = true;
				}
			}
		}

		this.looks.procedural = readLook(config.procedural, this.looks.procedural);
		this.looks.swarm = readLook(config.swarm, this.looks.swarm);
		this.pushLookToRenderer('procedural');
		this.pushLookToRenderer('swarm');
	}

	setupInspectorControls(inspectorInstance: any): any {
		const refs = this.renderer.getRefs();
		const gui = inspectorInstance.createParameters('Transition Shader');
		gui.close();

		const playback = {
			progress: refs.cloudTransitionProgress?.value ?? 0,
			sweepDirection: refs.cloudTransitionSweepDirection?.value ?? 1
		};
		const playbackFolder = gui.addFolder('Playback');
		if (refs.cloudTransitionProgress) {
			playbackFolder
				.add(playback, 'progress', 0, 1, 0.001)
				.name('progress')
				.onChange((value: number) => {
					this.renderer.setCloudTransitionFillProgress(Number(value));
					playback.progress = Number(value);
				});
		}
		if (refs.cloudTransitionSweepDirection) {
			playbackFolder
				.add(playback, 'sweepDirection', { '−1 (forward)': -1, '+1 (backward)': 1 })
				.name('sweep direction')
				.onChange((value: number) => {
					this.renderer.setCloudTransitionSweepDirection(value === -1 ? -1 : 1);
					playback.sweepDirection = value === -1 ? -1 : 1;
				});
		}
		playbackFolder
			.add({ bypass: false }, 'bypass')
			.name('bypass')
			.onChange((enabled: boolean) => {
				if (!enabled) return;
				this.renderer.setCloudTransitionFillProgress(0);
				playback.progress = 0;
			});

		// Transition start/end is now authored as keyframed 0→1 ramps on the
		// `Transition` Theatre object (`1→2 wipe` / `2→3 wipe`) — drag the markers
		// on the timeline. No lil-gui timing sliders here anymore.
		this.addPairFolder(gui, 'procedural', 'Procedural (1→2)');
		this.addPairFolder(gui, 'swarm', 'Swarm (2→3)');

		return gui;
	}

	private addPairFolder(gui: any, pair: TransitionPairId, label: string): void {
		const draft = cloneLook(this.looks[pair]);
		const folder = gui.addFolder(label);
		folder
			.add(draft, 'smearStrength', 0, 1, 0.005)
			.name('smear strength')
			.onChange((v: number) => this.setLookField(pair, 'smearStrength', v));
		folder
			.add(draft, 'caStrength', 0, 0.5, 0.001)
			.name('ca strength')
			.onChange((v: number) => this.setLookField(pair, 'caStrength', v));
		folder
			.add(draft, 'maskSoftness', 0.01, 0.6, 0.005)
			.name('mask softness')
			.onChange((v: number) => this.setLookField(pair, 'maskSoftness', v));
		folder
			.add(draft, 'axisIndex', { 'X sweep': 0, 'Y sweep': 1 })
			.name('axis')
			.onChange((v: number) => this.setLookField(pair, 'axisIndex', v >= 0.5 ? 1 : 0));
		folder
			.add(draft, 'noiseScaleX', 0.1, 20, 0.05)
			.name('noise scale X')
			.onChange((v: number) => this.setLookField(pair, 'noiseScaleX', v));
		folder
			.add(draft, 'noiseScaleY', 0.1, 20, 0.05)
			.name('noise scale Y')
			.onChange((v: number) => this.setLookField(pair, 'noiseScaleY', v));
		folder
			.add(draft, 'noiseScrollSpeed', 0, 2, 0.005)
			.name('noise scroll speed')
			.onChange((v: number) => this.setLookField(pair, 'noiseScrollSpeed', v));
		folder
			.add(draft, 'maskNoiseStrength', 0, 1, 0.005)
			.name('mask noise strength')
			.onChange((v: number) => this.setLookField(pair, 'maskNoiseStrength', v));
		folder
			.add(draft, 'detailNoiseAmount', 0, 1, 0.005)
			.name('detail noise amount')
			.onChange((v: number) => this.setLookField(pair, 'detailNoiseAmount', v));
		folder
			.add(draft, 'radialStrength', 0, 1, 0.005)
			.name('radial strength')
			.onChange((v: number) => this.setLookField(pair, 'radialStrength', v));
		folder
			.add(draft, 'radialOriginX', 0, 1, 0.005)
			.name('radial origin X')
			.onChange((v: number) => this.setLookField(pair, 'radialOriginX', v));
		folder
			.add(draft, 'radialOriginY', 0, 1, 0.005)
			.name('radial origin Y')
			.onChange((v: number) => this.setLookField(pair, 'radialOriginY', v));
		folder
			.add(draft, 'radialRadius', 0, 1, 0.005)
			.name('radial radius (dead-zone)')
			.onChange((v: number) => this.setLookField(pair, 'radialRadius', v));
		folder
			.add(draft, 'radialSpreadX', -4, 4, 0.05)
			.name('radial spread X (fan width)')
			.onChange((v: number) => this.setLookField(pair, 'radialSpreadX', v));
		folder
			.add(draft, 'pixelStrength', 0, 1, 0.005)
			.name('pixel strength')
			.onChange((v: number) => this.setLookField(pair, 'pixelStrength', v));
		folder
			.add(draft, 'pixelBlockSize', 0.004, 0.25, 0.002)
			.name('pixel block size')
			.onChange((v: number) => this.setLookField(pair, 'pixelBlockSize', v));
		folder
			.add(draft, 'pixelGlitchAmount', 0, 1, 0.005)
			.name('pixel glitch amount')
			.onChange((v: number) => this.setLookField(pair, 'pixelGlitchAmount', v));
	}

	private setLookField<K extends keyof TransitionLookParams>(
		pair: TransitionPairId,
		key: K,
		value: TransitionLookParams[K]
	): void {
		this.looks[pair][key] = value;
		this.pushLookToRenderer(pair);
	}

	private pushLookToRenderer(pair: TransitionPairId): void {
		this.renderer.setTransitionLook(pair, this.looks[pair]);
	}
}

export default Transition;
