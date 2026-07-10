import * as THREE from 'three';
import type Renderer from '../postprocessing/Renderer';
import type { SceneIndex } from '../sceneLayers';
import {
	type SceneTimeline,
	DEFAULT_SCENE_TIMELINE,
	mapToContentTimelineProgress
} from './sceneTimeline';
import { resolveCloudFill } from './sceneUiTiming';
import { pickTransitionPair } from '../postprocessing/transitionLooks';

// --- Deps -------------------------------------------------------------------

export interface AnimationControllerDeps {
	postProcessingManager: Renderer;
	timeline?: SceneTimeline;
}

// --- Math / easing helpers --------------------------------------------------

const power2InOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const saturate = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const easeInOut = (t: number) => power2InOut(saturate(t));

// --- Main class -------------------------------------------------------------

/**
 * Owns the THREE `AnimationMixer` + scroll-linked actions and the cloud
 * cross-fade, which is derived purely from scroll POSITION: both transition
 * pairs are pinned to a single (backward) configuration, so reversing scroll
 * mid-transition rewinds the same animation continuously instead of swapping
 * from/to + flipping the sweep.
 *
 * Per-frame scalar tracks (bloom, vignette, smoke, fog, lights, particle
 * opacities, slider transforms, canvas invert, scene visibility) are owned by
 * Theatre.js — see `TheatreController` and `src/lib/scene/theatre/features/`.
 */
export class AnimationController {
	private mixer: THREE.AnimationMixer | null = null;
	private readonly clips = new Map<string, THREE.AnimationClip>();
	private readonly actions = new Map<string, THREE.AnimationAction>();
	private readonly timer = new THREE.Timer();

	private deps: AnimationControllerDeps | null = null;
	private timeline: SceneTimeline = DEFAULT_SCENE_TIMELINE;
	private pipelineReady = false;

	private lastCrossFadePhase: 'idle' | 'fillIn' | 'hold' | 'fadeOut' = 'idle';
	private lastCloudFillProgress = 0;
	private lastCloudRawProgress = 0;
	private cloudSettleProgress = 0;
	private cloudSettlePhase: 'fillIn' | 'fadeOut' | null = null;
	private static readonly CLOUD_SETTLE_DECAY = 0.78;
	private static readonly CLOUD_SETTLE_EPSILON = 0.003;

	constructor() {
		this.timer.connect(document);
	}

	// --- Playback -----------------------------------------------------------

	attachMixer(root: THREE.Object3D): void {
		this.mixer = new THREE.AnimationMixer(root);
		// Progress is scroll-driven; wall-time advance is disabled.
		this.mixer.timeScale = 0;
	}

	hasMixer(): boolean {
		return this.mixer !== null;
	}

	registerClips(clips: readonly THREE.AnimationClip[]): void {
		for (const clip of clips) this.clips.set(clip.name, clip);
	}

	getAnimationNames(): string[] {
		return Array.from(this.clips.keys());
	}

	getClipDuration(name: string): number | undefined {
		return this.clips.get(name)?.duration;
	}

	/** Create one paused `LoopOnce` action per clip; advance them via `setScrollProgress`. */
	startScrollActions(): void {
		if (!this.mixer) {
			console.warn('AnimationController: no mixer attached');
			return;
		}
		for (const [name, clip] of this.clips) {
			this.actions.get(name)?.stop();
			const action = this.mixer.clipAction(clip);
			action.loop = THREE.LoopOnce;
			action.clampWhenFinished = true;
			action.paused = true;
			action.play();
			this.actions.set(name, action);
		}
	}

	getScrollAction(name: string): THREE.AnimationAction | null {
		return this.actions.get(name) ?? null;
	}

	/** Move every active action to the same normalized time and flush the mixer. */
	setScrollProgress(progress: number): void {
		const t = saturate(progress);
		for (const action of this.actions.values()) {
			action.time = t * action.getClip().duration;
		}
		this.mixer?.update(0);
	}

	/** Advance the mixer by zero to flush action.time changes made externally. */
	flushMixer(): void {
		this.mixer?.update(0);
	}

	tickTimer(timestamp?: number): number {
		this.timer.update(timestamp);
		return this.timer.getDelta();
	}

	dispose(): void {
		for (const action of this.actions.values()) action.stop();
		this.actions.clear();
		this.timer.disconnect();
	}

	// --- Pipeline -----------------------------------------------------------

	configurePipeline(deps: AnimationControllerDeps): void {
		this.deps = deps;
		this.timeline = deps.timeline ?? DEFAULT_SCENE_TIMELINE;
		this.pipelineReady = true;
	}

	updateForProgress(normalizedProgress: number): void {
		if (!this.pipelineReady) return;
		const p = mapToContentTimelineProgress(normalizedProgress, this.timeline);
		this.updateSceneCrossFade(p);
	}

	// --- Cloud cross-fade ---------------------------------------------------

	private updateSceneCrossFade(p: number): void {
		const renderer = this.deps?.postProcessingManager;
		if (!renderer) return;
		// Sweep amount of each wipe at this scroll position — the keyframed Theatre
		// values when authored, else synthesized from the fallback thresholds.
		const fill = resolveCloudFill(p);
		const v1 = saturate(fill.oneToTwo);
		const v2 = saturate(fill.twoToThree);

		// Phase from the two 0→1 ramps: before 1→2 (v1≤0) → idle; mid 1→2 → fillIn;
		// 1→2 complete but 2→3 not begun → hold; mid 2→3 → fadeOut; past 2→3 → idle.
		// Theatre holds endpoint values exactly outside the keyframe range, so the
		// ≤0 / ≥1 boundaries are robust.
		let phase: 'idle' | 'fillIn' | 'hold' | 'fadeOut';
		if (v1 <= 0) phase = 'idle';
		else if (v1 < 1) phase = 'fillIn';
		else if (v2 <= 0) phase = 'hold';
		else if (v2 < 1) phase = 'fadeOut';
		else phase = 'idle';

		// Progress for both pairs is taken straight off scroll POSITION (`1 − v`),
		// NOT the instantaneous scroll direction (matches the backward-config pinning
		// below). The old `forward ? v : 1 − v` made progress DISCONTINUOUS the instant
		// the detected direction flipped mid-transition (e.g. 0.6 → 0.4), popping the
		// smear; `1 − v` means reversing direction just rewinds the same animation
		// smoothly. `v` already falls as the playhead retreats, so this stays monotonic.
		let cloudProgress = 0;
		if (phase === 'fillIn') {
			cloudProgress = 1 - v1;
		} else if (phase === 'fadeOut') {
			cloudProgress = 1 - v2;
		}

		if (phase === 'fillIn' || phase === 'fadeOut') {
			this.cloudSettleProgress = 0;
			this.cloudSettlePhase = null;
		}

		// If scroll jumps past the end of fadeOut while smear is still visible,
		// ease the remaining distance into the destination endpoint. This must
		// settle toward progress=1: for the 2→3 pair, progress=0 is scene 2, and
		// scene 2 can be visually black once the slider has exited.
		const leftFadeOut =
			this.lastCrossFadePhase === 'fadeOut' && phase === 'idle';
		if (leftFadeOut && this.cloudSettleProgress <= AnimationController.CLOUD_SETTLE_EPSILON) {
			if (this.lastCloudRawProgress >= 0.72 && this.lastCloudRawProgress < 0.995) {
				this.cloudSettleProgress = 1 - this.lastCloudRawProgress;
				this.cloudSettlePhase = this.lastCrossFadePhase as 'fillIn' | 'fadeOut';
			}
		}

		let renderPhase = phase;
		if (this.cloudSettleProgress > AnimationController.CLOUD_SETTLE_EPSILON) {
			this.cloudSettleProgress *= AnimationController.CLOUD_SETTLE_DECAY;
			cloudProgress = 1 - this.cloudSettleProgress;
			renderPhase = this.cloudSettlePhase ?? phase;
		} else {
			this.cloudSettleProgress = 0;
			this.cloudSettlePhase = null;
		}

		// Active scene from the same ramps: scene 2 once the 1→2 wipe has begun,
		// scene 3 once the 2→3 wipe has begun (matches `resolveCloudActiveScene`,
		// which the stage router uses — so the RT layer swap follows the keyframes).
		const active = (v2 > 0 ? 3 : v1 > 0 ? 2 : 1) as SceneIndex;
		// Both pairs are pinned to their BACKWARD configuration (1→2 = from 2→to 1,
		// 2→3 = from 3→to 2; sweep +1) regardless of live scroll direction, so
		// reversing direction mid-transition can't swap from/to or flip the sweep —
		// the smear stays continuous and just rewinds (progress is `1 − v` above).
		// This is also the look that read correctly on reverse scroll, so forward now
		// matches it for both pairs.
		const transitionPair = this.resolveTransitionPair(renderPhase, 'backward');
		renderer.setActiveScenes(active, transitionPair?.from ?? null, transitionPair?.to ?? null);
		renderer.setCloudTransitionSweepDirection(1);
		renderer.setActiveTransitionPair(
			pickTransitionPair(transitionPair?.from ?? null, transitionPair?.to ?? null)
		);

		const easedProgress = easeInOut(cloudProgress);
		this.lastCloudRawProgress = cloudProgress;
		this.lastCloudFillProgress = easedProgress;
		renderer.setCloudTransitionFillProgress(easedProgress);
		// Feedback decay tracks the shader's global bell (4p(1-p)): zero at
		// the edges of the transition, peak ~1 mid-transition. Scaled to
		// 0.85 so persistence ≈ 6 frames at peak (~100ms tail at 60fps).
		// Idle frames stay at 0 → feedback pipeline is identity, no cost.
		const envelope = 4 * easedProgress * (1 - easedProgress);
		renderer.setFeedbackDecay(0.85 * envelope);
		this.lastCrossFadePhase = phase;
	}

	/**
	 * Map (phase, direction) to the (from, to) pair the cloud's diagonal cut
	 * should mix between. `null` outside transition windows. Now always called
	 * with `'backward'` (both pairs are pinned to that configuration so the
	 * transition is a continuous function of scroll position); the `direction`
	 * param is retained so the from/to mapping stays explicit and self-documenting.
	 */
	private resolveTransitionPair(
		phase: 'idle' | 'fillIn' | 'hold' | 'fadeOut',
		direction: 'forward' | 'backward'
	): { from: SceneIndex; to: SceneIndex } | null {
		if (phase === 'fillIn') {
			return direction === 'forward' ? { from: 1, to: 2 } : { from: 2, to: 1 };
		}
		if (phase === 'fadeOut') {
			return direction === 'forward' ? { from: 2, to: 3 } : { from: 3, to: 2 };
		}
		return null;
	}
}
