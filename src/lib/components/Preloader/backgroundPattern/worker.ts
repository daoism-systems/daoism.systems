/// <reference lib="webworker" />
import { createBackgroundPatternEngine, type BackgroundPatternEngine } from './engine';

type WorkerInbound =
	| {
			type: 'init';
			canvas: OffscreenCanvas;
			dpr: number;
			width: number;
			height: number;
			reducedMotion: boolean;
	  }
	| { type: 'resize'; width: number; height: number }
	| { type: 'pointer'; x: number; y: number }
	| { type: 'visible'; visible: boolean }
	| { type: 'progress'; value: number }
	| { type: 'dispose' };

export type WorkerOutbound =
	| { type: 'transitionComplete' }
	| { type: 'displayProgress'; value: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: BackgroundPatternEngine | null = null;

ctx.onmessage = (event: MessageEvent<WorkerInbound>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			engine = createBackgroundPatternEngine({
				canvas: message.canvas,
				dpr: message.dpr,
				reducedMotion: message.reducedMotion,
				onTransitionComplete: () => ctx.postMessage({ type: 'transitionComplete' } satisfies WorkerOutbound),
				onDisplayProgress: (value) =>
					ctx.postMessage({ type: 'displayProgress', value } satisfies WorkerOutbound)
			});
			engine.resize(message.width, message.height);
			engine.start();
			break;
		case 'resize':
			engine?.resize(message.width, message.height);
			break;
		case 'pointer':
			engine?.setPointer(message.x, message.y);
			break;
		case 'visible':
			engine?.setVisible(message.visible);
			break;
		case 'progress':
			engine?.setProgress(message.value);
			break;
		case 'dispose':
			engine?.stop();
			engine = null;
			break;
	}
};
