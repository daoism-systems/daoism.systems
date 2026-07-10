import { Howl } from 'howler';

type HowlConfig = ConstructorParameters<typeof Howl>[0];

const SFX_CONFIG = {
	bgMusic: {
		src: '/sounds/bg-music.mp3',
		preload: true,
		loop: true,
		volume: 0.7
	},
	click: {
		src: '/sounds/click.mp3',
		preload: true,
		loop: false,
		volume: 0.25
	},
	clickAlt: {
		src: '/sounds/click-alt.wav',
		preload: true,
		loop: false,
		volume: 0.1
	},
	hover: {
		src: '/sounds/hover.mp3',
		preload: true,
		loop: false,
		volume: 0.25
	},
	transition: {
		src: '/sounds/transition.mp3',
		preload: true,
		loop: false,
		volume: 0.25
	}
} satisfies Record<string, HowlConfig>;

type SfxKey = keyof typeof SFX_CONFIG;

function createKeyMap<T extends Record<string, unknown>>(source: T): { [K in keyof T]: K } {
	const map = {} as { [K in keyof T]: K };
	for (const key of Object.keys(source) as Array<keyof T>) {
		map[key] = key;
	}
	return Object.freeze(map);
}

export const SFX_KEY = createKeyMap(SFX_CONFIG);

class SfxService {
	private cache = new Map<SfxKey, Howl>();

	private canUseAudio(): boolean {
		return typeof window !== 'undefined' && window.location.pathname === '/';
	}

	get(key: SfxKey): Howl | null {
		if (!this.canUseAudio()) return null;

		const existing = this.cache.get(key);
		if (existing) return existing;

		const howl = new Howl(SFX_CONFIG[key] as HowlConfig);
		this.cache.set(key, howl);
		return howl;
	}

	play(key: SfxKey): void {
		this.get(key)?.play();
	}

	isPlaying(key: SfxKey): boolean {
		return this.get(key)?.playing() ?? false;
	}
}

export const sfx = new SfxService();
export type { SfxKey };
