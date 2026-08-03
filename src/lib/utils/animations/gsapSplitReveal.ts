import { DURATIONS } from './constants/durations';
import { EASINGS } from './constants/easings';

export type GsapSplitRevealMode = 'chars' | 'lines';

export type GsapSplitRevealOptions = {
	enabled?: boolean;
	progress?: number;
	split?: GsapSplitRevealMode;
	duration?: number;
	stagger?: number;
	ease?: string;
	yPercent?: number;
	progressPower?: number;
};

type GsapApi = typeof import('gsap').gsap;
type SplitTextConstructor = typeof import('gsap/SplitText').SplitText;
type SplitTextInstance = InstanceType<SplitTextConstructor>;
type GsapContext = ReturnType<GsapApi['context']>;
type GsapTimeline = ReturnType<GsapApi['timeline']>;

type GsapSplitTextRuntime = {
	gsap: GsapApi;
	SplitText: SplitTextConstructor;
};

const DEFAULT_DURATION = DURATIONS.MOTION_REVEAL_DURATION / 1000;
const DEFAULT_STAGGER: Record<GsapSplitRevealMode, number> = {
	chars: 0.008,
	lines: 0.055
};
const DEFAULT_EASE = 'daoismSplitReveal';
const DEFAULT_Y_PERCENT = 100;
const WIDTH_CHANGE_EPSILON = 0.5;
const CSS_CUBIC_BEZIER_PATTERN = /^cubic-bezier\(([^)]+)\)$/;

let runtimePromise: Promise<GsapSplitTextRuntime> | null = null;

function toCustomEaseData(easing: string): string {
	return CSS_CUBIC_BEZIER_PATTERN.exec(easing.trim())?.[1] ?? easing;
}

function loadGsapSplitText(): Promise<GsapSplitTextRuntime> {
	if (!runtimePromise) {
		runtimePromise = Promise.all([
			import('gsap'),
			import('gsap/SplitText'),
			import('gsap/CustomEase')
		]).then(([{ gsap }, { SplitText }, { CustomEase }]) => {
			gsap.registerPlugin(SplitText, CustomEase);
			CustomEase.create(DEFAULT_EASE, toCustomEaseData(EASINGS.EASE_POWER2_OUT));
			return { gsap, SplitText };
		});
	}

	return runtimePromise;
}

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function resolveProgress({ progress = 0, progressPower = 1 }: GsapSplitRevealOptions): number {
	const safePower = Number.isFinite(progressPower) && progressPower > 0 ? progressPower : 1;
	return clampProgress(progress) ** safePower;
}

function hasStructuralChange(
	previous: GsapSplitRevealOptions,
	next: GsapSplitRevealOptions
): boolean {
	return (
		previous.split !== next.split ||
		previous.duration !== next.duration ||
		previous.stagger !== next.stagger ||
		previous.ease !== next.ease ||
		previous.yPercent !== next.yPercent
	);
}

class GsapSplitRevealController {
	private options: GsapSplitRevealOptions;
	private runtime: GsapSplitTextRuntime | null = null;
	private context: GsapContext | null = null;
	private splitText: SplitTextInstance | null = null;
	private timeline: GsapTimeline | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private motionPreference: MediaQueryList | null = null;
	private fontSet: FontFaceSet | null = null;
	private rebuildFrame: number | null = null;
	private observedWidth = 0;
	private currentProgress: number;
	private activationId = 0;
	private active = false;
	private destroyed = false;

	constructor(
		private readonly node: HTMLElement,
		initialOptions: GsapSplitRevealOptions
	) {
		this.options = initialOptions;
		this.currentProgress = resolveProgress(initialOptions);
	}

	init(): void {
		if (this.options.enabled) void this.activate();
	}

	update(nextOptions: GsapSplitRevealOptions): void {
		const wasEnabled = this.options.enabled === true;
		const shouldRebuild = hasStructuralChange(this.options, nextOptions);
		this.options = nextOptions;
		this.currentProgress = resolveProgress(nextOptions);

		if (!nextOptions.enabled) {
			if (wasEnabled) this.deactivate();
			return;
		}

		if (!wasEnabled) {
			void this.activate();
			return;
		}

		if (shouldRebuild && this.runtime) {
			this.build();
			return;
		}

		this.applyProgress();
	}

	destroy(): void {
		this.destroyed = true;
		this.deactivate();
	}

	private async activate(): Promise<void> {
		if (this.active || this.destroyed) return;
		this.active = true;
		const activationId = ++this.activationId;
		const runtime = await loadGsapSplitText();

		if (
			this.destroyed ||
			!this.active ||
			!this.options.enabled ||
			activationId !== this.activationId
		) {
			return;
		}

		this.runtime = runtime;
		this.setupLayoutObservers();
		this.build();
	}

	private deactivate(): void {
		this.active = false;
		this.activationId += 1;
		this.cancelScheduledRebuild();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.motionPreference?.removeEventListener('change', this.handleMotionPreferenceChange);
		this.motionPreference = null;
		this.fontSet?.removeEventListener('loadingdone', this.handleFontsLoaded);
		this.fontSet = null;
		this.clearAnimation();
		this.runtime = null;
	}

	private setupLayoutObservers(): void {
		this.observedWidth = this.node.getBoundingClientRect().width;
		this.resizeObserver = new ResizeObserver(([entry]) => {
			const nextWidth = entry?.contentRect.width ?? this.node.getBoundingClientRect().width;
			if (Math.abs(nextWidth - this.observedWidth) < WIDTH_CHANGE_EPSILON) return;
			this.observedWidth = nextWidth;
			this.scheduleRebuild();
		});
		this.resizeObserver.observe(this.node);

		this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
		this.motionPreference.addEventListener('change', this.handleMotionPreferenceChange);

		this.fontSet = document.fonts ?? null;
		this.fontSet?.addEventListener('loadingdone', this.handleFontsLoaded);
	}

	private readonly handleFontsLoaded = (): void => {
		this.scheduleRebuild();
	};

	private readonly handleMotionPreferenceChange = (): void => {
		this.scheduleRebuild();
	};

	private scheduleRebuild(): void {
		if (this.rebuildFrame !== null || !this.active) return;

		this.rebuildFrame = requestAnimationFrame(() => {
			this.rebuildFrame = null;
			if (!this.active || this.destroyed || !this.options.enabled) return;
			this.build();
		});
	}

	private cancelScheduledRebuild(): void {
		if (this.rebuildFrame === null) return;
		cancelAnimationFrame(this.rebuildFrame);
		this.rebuildFrame = null;
	}

	private build(): void {
		this.clearAnimation();
		if (!this.runtime || this.motionPreference?.matches) return;

		const { gsap, SplitText } = this.runtime;
		const mode = this.options.split ?? 'chars';

		this.context = gsap.context(() => {
			const splitText = SplitText.create(this.node, {
				type: mode === 'chars' ? 'words,chars' : 'lines',
				mask: mode,
				tag: 'span',
				aria: 'auto',
				autoSplit: false,
				wordsClass: 'gsap-split-reveal-word',
				charsClass: 'gsap-split-reveal-char',
				linesClass: 'gsap-split-reveal-line'
			});
			this.splitText = splitText;

			const targets = mode === 'chars' ? splitText.chars : splitText.lines;
			if (!targets.length) return;

			if (mode === 'chars') {
				gsap.set([...splitText.words, ...splitText.chars, ...splitText.masks], {
					display: 'inline-block'
				});
			} else {
				gsap.set([...splitText.lines, ...splitText.masks], { display: 'block' });
			}

			this.timeline = gsap.timeline({ paused: true }).fromTo(
				targets,
				{
					autoAlpha: 0,
					yPercent: this.options.yPercent ?? DEFAULT_Y_PERCENT
				},
				{
					autoAlpha: 1,
					yPercent: 0,
					duration: this.options.duration ?? DEFAULT_DURATION,
					stagger: this.options.stagger ?? DEFAULT_STAGGER[mode],
					ease: this.options.ease ?? DEFAULT_EASE
				}
			);
		}, this.node);

		this.applyProgress();
	}

	private applyProgress(): void {
		if (this.motionPreference?.matches) return;
		this.timeline?.pause().progress(this.currentProgress, true);
	}

	private clearAnimation(): void {
		const context = this.context;
		const timeline = this.timeline;
		const splitText = this.splitText;

		this.context = null;
		this.timeline = null;
		this.splitText = null;

		context?.revert();
		timeline?.kill();
		if (splitText?.isSplit) splitText.revert();
	}
}

export function gsapSplitReveal(node: HTMLElement, initialOptions: GsapSplitRevealOptions = {}) {
	const controller = new GsapSplitRevealController(node, initialOptions);
	controller.init();

	return {
		update(nextOptions: GsapSplitRevealOptions) {
			controller.update(nextOptions);
		},
		destroy() {
			controller.destroy();
		}
	};
}
