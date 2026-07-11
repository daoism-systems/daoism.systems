export const konamiSequence = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'b',
	'a'
] as const;

export const konamiGlyphs = ['↑', '↑', '↓', '↓', '←', '→', '←', '→', 'B', 'A'] as const;

const RESET_DELAY_MS = 2400;

class KonamiTracker {
	index = $state(0);
	private resetTimer: ReturnType<typeof setTimeout> | null = null;
	private onComplete: (() => void) | null = null;

	setOnComplete(fn: (() => void) | null): void {
		this.onComplete = fn;
	}

	processKey(rawKey: string): void {
		const expected = konamiSequence[this.index];
		const pressed = expected.startsWith('Arrow') ? rawKey : rawKey.toLowerCase();
		if (pressed === expected) {
			this.index++;
			if (this.index === konamiSequence.length) {
				this.clear();
				this.onComplete?.();
				return;
			}
			this.scheduleReset();
		} else {
			this.index = pressed === konamiSequence[0] ? 1 : 0;
			if (this.index > 0) this.scheduleReset();
		}
	}

	reset(): void {
		this.clear();
	}

	private scheduleReset(): void {
		if (this.resetTimer !== null) clearTimeout(this.resetTimer);
		this.resetTimer = setTimeout(() => {
			this.index = 0;
			this.resetTimer = null;
		}, RESET_DELAY_MS);
	}

	private clear(): void {
		if (this.resetTimer !== null) {
			clearTimeout(this.resetTimer);
			this.resetTimer = null;
		}
		this.index = 0;
	}
}

export const konami = new KonamiTracker();
