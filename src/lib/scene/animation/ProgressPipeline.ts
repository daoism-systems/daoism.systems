import {
	DEFAULT_SCENE_TIMELINE,
	mapToContentTimelineProgress,
	type SceneTimeline
} from './sceneTimeline';
import { PROGRESS_EPSILON } from './sceneUiTiming';
import type { IntroTransition } from '../transitions/IntroTransition';

export interface ProgressPipelineDeps {
	introTransition: IntroTransition;
}

/**
 * Owns the scroll-progress state machine: the dirty/pending/last-progress
 * triplet that gates per-frame `applyProgressNow` calls, the active page
 * section, and the scene timeline. Public scroll input goes through
 * `setScroll`, which normalizes raw input against the intro-transition's end
 * progress so post-intro scroll resumes from where the tween finished.
 *
 * The host (MainScene) keeps `applyProgressNow` itself — that fan-out's
 * dependency surface is too wide to move without a god-host pattern. The
 * pipeline owns the *math* (mapping) and the *state*; the host owns the
 * orchestration that calls it.
 */
export class ProgressPipeline {
	private lastProgress = -1;
	private pendingProgress = 0;
	private cameraDirty = false;

	private activePageSection = 0;
	private activePageSectionProgress = 0;

	private sceneTimeline: SceneTimeline = DEFAULT_SCENE_TIMELINE;

	constructor(private readonly deps: ProgressPipelineDeps) {}

	// ── Timeline ───────────────────────────────────────────────────────────

	public setSceneTimeline(timeline: SceneTimeline): void {
		this.sceneTimeline = timeline;
	}

	public getSceneTimeline(): SceneTimeline {
		return this.sceneTimeline;
	}

	public mapToContentTimelineProgress(p: number): number {
		return mapToContentTimelineProgress(p, this.sceneTimeline);
	}

	// ── Public scroll entry point ──────────────────────────────────────────

	/**
	 * Memoizes; sets cameraDirty when the normalized progress changes. No-op
	 * while the intro transition is animating (its tween owns progress until it
	 * completes).
	 */
	public setScroll(rawProgress: number): void {
		if (this.deps.introTransition.isActive()) return;

		const inputProgress = Math.max(0, Math.min(1, rawProgress / 100));
		const endProgress = this.deps.introTransition.getEndProgress();
		const normalizedProgress = this.deps.introTransition.isStarted()
			? endProgress + inputProgress * (1 - endProgress)
			: inputProgress;

		if (normalizedProgress === this.lastProgress) return;
		this.lastProgress = normalizedProgress;
		this.cameraDirty = true;
		this.pendingProgress = normalizedProgress;
	}

	// ── Active page section ────────────────────────────────────────────────

	public setActivePageSection(sectionIndex: number, sectionProgress: number): void {
		if (
			sectionIndex === this.activePageSection &&
			Math.abs(sectionProgress - this.activePageSectionProgress) < PROGRESS_EPSILON
		) {
			return;
		}
		this.activePageSection = sectionIndex;
		this.activePageSectionProgress = sectionProgress;
	}

	public getActivePageSection(): number {
		return this.activePageSection;
	}

	public getActivePageSectionProgress(): number {
		return this.activePageSectionProgress;
	}

	// ── Dirty-flag accessors ──────────────────────────────────────────────

	/**
	 * Returns the pending progress and clears the dirty flag, or null when
	 * nothing's queued. Used by the host's per-frame loop to decide whether
	 * `applyProgressNow` should run.
	 */
	public consumeDirty(): number | null {
		if (!this.cameraDirty) return null;
		this.cameraDirty = false;
		return this.pendingProgress;
	}

	/** Non-consuming dirty check — for gates that must not clear the flag. */
	public isDirty(): boolean {
		return this.cameraDirty;
	}

	public setLastProgress(p: number): void {
		this.lastProgress = p;
	}

	public setPendingProgress(p: number): void {
		this.pendingProgress = p;
	}

	public getLastProgress(): number {
		return this.lastProgress;
	}

	public getPendingProgress(): number {
		return this.pendingProgress;
	}
}
