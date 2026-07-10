import type { SceneStage, SceneStageBindings } from './SceneStage';

/**
 * Routes scroll progress to the active `SceneStage`, runs activate/deactivate
 * exactly once at boundary crossings, and ticks the active stage while its
 * range is live.
 */
export class StageDispatcher {
	private readonly stages: readonly SceneStage[];
	private activeIndex = -1;

	constructor(stages: readonly SceneStage[]) {
		if (stages.length === 0) {
			throw new Error('StageDispatcher requires at least one stage');
		}
		this.stages = stages;
	}

	bindGltf(bindings: SceneStageBindings): void {
		for (const stage of this.stages) {
			stage.bindGltf(bindings);
		}
	}

	getActiveStage(): SceneStage | null {
		return this.activeIndex >= 0 ? this.stages[this.activeIndex] : null;
	}

	getStages(): readonly SceneStage[] {
		return this.stages;
	}

	/**
	 * Array slot for the stage owning this scene index (1/2/3). Falls back to the
	 * last stage if not found (defensive — every scene index has a stage).
	 */
	private resolveStageIndexByScene(sceneIndex: number): number {
		const i = this.stages.findIndex((s) => s.index === sceneIndex);
		return i >= 0 ? i : this.stages.length - 1;
	}

	/**
	 * Update active stage + frame tick. Call from `MainScene.applyProgressNow`
	 * (and equivalents) once per scroll/frame update. `activeSceneIndex` (1/2/3)
	 * comes from the cloud-transition fill ramps (`resolveCloudActiveScene`), so
	 * the RT layer swap follows the authored keyframes rather than a fixed
	 * scroll-position threshold.
	 */
	update(activeSceneIndex: number, delta: number): void {
		const targetIndex = this.resolveStageIndexByScene(activeSceneIndex);
		if (targetIndex !== this.activeIndex) {
			if (this.activeIndex >= 0) {
				this.stages[this.activeIndex].deactivate();
			}
			this.activeIndex = targetIndex;
			this.stages[this.activeIndex].activate();
		}

		const active = this.stages[this.activeIndex];
		active.update(0, delta);
	}

	dispose(): void {
		if (this.activeIndex >= 0) {
			this.stages[this.activeIndex].deactivate();
			this.activeIndex = -1;
		}
	}
}
