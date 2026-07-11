import type { MusicState, PadLabel, PopupTier, RunHudState } from './voidHero.helpers';

export interface ScreenPopup {
	text: string;
	tier: PopupTier;
	x: number;
	y: number;
}

export type SceneEvent =
	| { kind: 'ready' }
	| { kind: 'runHud'; state: RunHudState }
	| { kind: 'music'; state: MusicState }
	| { kind: 'popup'; popup: ScreenPopup }
	| { kind: 'padLabels'; labels: PadLabel[] }
	| { kind: 'secretRequest' }
	| { kind: 'gameOver' };

export type SceneEventHandler = (event: SceneEvent) => void;

export class SceneEventBus {
	private handlers = new Set<SceneEventHandler>();

	emit(event: SceneEvent): void {
		for (const handler of this.handlers) handler(event);
	}

	subscribe(handler: SceneEventHandler): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	clear(): void {
		this.handlers.clear();
	}
}
