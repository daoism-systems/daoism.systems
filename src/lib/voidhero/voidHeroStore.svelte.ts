import type { MusicState, PadLabel, RunHudState } from './voidHero.helpers';
import type { SceneEvent, ScreenPopup } from './events';

export type GamePhase = 'idle' | 'ready' | 'playing' | 'ended';

export type StoredPopup = ScreenPopup & { id: number };

const ALLOWED_TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
	idle: ['ready'],
	ready: ['playing', 'idle'],
	playing: ['ended', 'idle'],
	ended: ['ready', 'idle']
};

const POPUP_CAP = 8;

function createInitialRunHud(): RunHudState {
	return {
		active: false,
		score: 0,
		combo: 0,
		message: 'Press D F J K',
		laneLabels: ['1', '2', '3', '4'],
		stageName: '',
		stageProgress: 0,
		progressionActive: false,
		lives: 3,
		maxLives: 3,
		heartStages: [1, 1, 1],
		bestScore: 0,
		bestStage: 'Drift'
	};
}

function createInitialMusicState(): MusicState {
	return {
		muted: false,
		tracks: [],
		currentTrackId: 'synthwave',
		volume: 0.55
	};
}

export const voidHeroState = $state({
	phase: 'idle' as GamePhase,
	runHud: createInitialRunHud(),
	music: createInitialMusicState(),
	lastRunHud: null as RunHudState | null,
	popups: [] as StoredPopup[],
	padLabels: [] as PadLabel[],
	transitioning: false
});

let popupIdCounter = 0;

function canTransition(from: GamePhase, to: GamePhase): boolean {
	return ALLOWED_TRANSITIONS[from].includes(to);
}

function resetRunUi(): void {
	voidHeroState.runHud = createInitialRunHud();
	voidHeroState.popups = [];
	voidHeroState.padLabels = [];
}

export function prepare(): boolean {
	if (!canTransition(voidHeroState.phase, 'ready')) return false;
	resetRunUi();
	voidHeroState.phase = 'ready';
	return true;
}

export function begin(): boolean {
	if (!canTransition(voidHeroState.phase, 'playing')) return false;
	voidHeroState.phase = 'playing';
	return true;
}

export function end(): boolean {
	if (!canTransition(voidHeroState.phase, 'ended')) return false;
	voidHeroState.lastRunHud = { ...voidHeroState.runHud };
	voidHeroState.phase = 'ended';
	return true;
}

export function restoreView(): void {
	if (voidHeroState.phase === 'idle') return;
	resetRunUi();
	voidHeroState.lastRunHud = null;
	voidHeroState.phase = 'idle';
}

export function setTransitioning(value: boolean): void {
	voidHeroState.transitioning = value;
}

export function removePopup(id: number): void {
	voidHeroState.popups = voidHeroState.popups.filter((p) => p.id !== id);
}

export function dispatch(event: SceneEvent): void {
	switch (event.kind) {
		case 'runHud':
			voidHeroState.runHud = event.state;
			break;
		case 'music':
			voidHeroState.music = event.state;
			break;
		case 'popup': {
			popupIdCounter += 1;
			const next = voidHeroState.popups.concat({ id: popupIdCounter, ...event.popup });
			if (next.length > POPUP_CAP) next.splice(0, next.length - POPUP_CAP);
			voidHeroState.popups = next;
			break;
		}
		case 'padLabels':
			voidHeroState.padLabels = event.labels;
			break;
		case 'ready':
		case 'gameOver':
		case 'secretRequest':
			break;
	}
}
