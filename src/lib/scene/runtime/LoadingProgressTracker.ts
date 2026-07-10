export type LoadingStage = 'benchmark' | 'objects' | 'pyramidAssets' | 'sceneSetup' | 'warmup';

type LoadingStageWeights = Record<LoadingStage, number>;
type LoadingStageState = Record<LoadingStage, number>;

export class LoadingProgressTracker {
	private stages: LoadingStageState = {
		benchmark: 0,
		objects: 0,
		pyramidAssets: 0,
		sceneSetup: 0,
		warmup: 0
	};

	constructor(
		private readonly weights: LoadingStageWeights,
		private readonly onProgress: (progress: number) => void
	) {}

	reset(): void {
		this.stages = {
			benchmark: 0,
			objects: 0,
			pyramidAssets: 0,
			sceneSetup: 0,
			warmup: 0
		};
		this.emit();
	}

	advance(stage: LoadingStage, progress: number): void {
		const clamped = Math.max(0, Math.min(1, progress));
		if (clamped <= this.stages[stage]) {
			return;
		}

		this.stages[stage] = clamped;
		this.emit();
	}

	private emit(): void {
		const total =
			this.stages.benchmark * this.weights.benchmark +
			this.stages.objects * this.weights.objects +
			this.stages.pyramidAssets * this.weights.pyramidAssets +
			this.stages.sceneSetup * this.weights.sceneSetup +
			this.stages.warmup * this.weights.warmup;
		this.onProgress(Math.min(100, total));
	}
}
