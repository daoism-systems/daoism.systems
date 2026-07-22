import * as THREE from 'three/webgpu';
import { vacancies } from '$lib/store.svelte';
import { getScene07AnnotationRange } from '../animation/sceneManifest';
import {
	createAnnotationOpenTimeline,
	createAnnotationRevealTimeline
} from '$lib/utils/animations/annotationReveal';
import { AnimationTimeline } from '$lib/utils/animations/helpers/animationTimeline';
import { fullScreenSmokeTransition } from '$lib/utils/fullScreenSmokeTransition';
import type { Unsubscriber } from 'svelte/store';

const annotationRevealAtProgressDesktop = [0.15, 0.5, 0.7] as const;
const annotationRevealAtProgressMobile = [0.3, 0.5, 0.6] as const;
const firstAnnotationHideAtProgress = 0.33;
const annotationVisibilityEndTrimMobile = 0.2;

// Opened-tooltip viewport clamp: only the OPENED tooltip's description panel is
// pulled back inside the viewport so it never clips while being read — including
// as the camera orbits the tree and the dot swings across the screen. A closed
// tooltip is left snug to its dot (no offset) and may scroll off-screen with its
// 3D anchor. Distances are CSS pixels; only `.hotspot__desc` moves, via the
// `--hotspot-magnet-x` var.
const EDGE_MAGNET_MARGIN = 28; // gap kept between the panel and the viewport edge

// Signed correction (px) that pulls the panel fully inside the safe area on
// whichever side it overflows. Positive pushes toward the high (right/bottom) edge.
function axisClamp(boxMin: number, boxMax: number, size: number): number {
	const lowOver = EDGE_MAGNET_MARGIN - boxMin; // crossed the near (left/top) margin
	const highOver = boxMax - (size - EDGE_MAGNET_MARGIN); // crossed the far (right/bottom) margin
	let delta = 0;
	if (lowOver > 0) delta += lowOver;
	if (highOver > 0) delta -= highOver;
	return delta;
}

export interface AnnotationsParams {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	rendererDomElement: HTMLCanvasElement;
	signObjects: THREE.Object3D[];
	fallbackPositions?: { x: number; y: number; z: number }[];
	mobilePositioning?: MobileAnnotationPositioning;
}

export interface MobileAnnotationPositioning {
	breakpoint?: number;
	globalOffset?: { x: number; y: number };
	perAnnotationOffset?: Partial<Record<number, { x: number; y: number }>>;
	constrainToViewport?: boolean;
	viewportPadding?: number;
	buttonToDescGap?: number;
}

interface AnnotationEntry {
	element: HTMLElement;
	position: { x: number; y: number; z: number };
	visible: boolean;
	desc?: HTMLElement | null;
	// Horizontal magnet offset (px) currently applied to the desc panel via the
	// `--hotspot-magnet-x` CSS var. Tracked so the panel's natural (un-docked) box
	// can be recovered each frame as `getBoundingClientRect().left - lastMagnetX`.
	lastMagnetX: number;
}

export class Annotations {
	private activeAnnotationIndex: number = -1;
	private annotationElements: HTMLElement[] = [];
	private annotationEntries: Map<string, AnnotationEntry> = new Map();
	private annotationOverlay?: HTMLElement;
	private readonly annotationRevealTimelines = new Map<number, AnimationTimeline>();
	private readonly annotationOpenTimelines = new Map<number, AnimationTimeline>();
	private readonly pendingRevealIndices = new Set<number>();
	private readonly pendingHideIndices = new Set<number>();
	private readonly hidingIndices = new Set<number>();
	private readonly hideAnimationTimeouts = new Map<number, number>();
	private _annotationsVisible = false;
	private _annotationsNeedFinalRender = false;
	private _annotationPositionsDirty = false;
	private lastAnnotationVisibility = false;
	private readonly _annotationNdc = new THREE.Vector3();
	private readonly _annotationWorldPos = new THREE.Vector3();
	private smokeTransitionUnsubscribe?: Unsubscriber;
	private isSmokeTransitionActive = false;
	private readonly mobilePositioning: {
		breakpoint: number;
		globalOffset: { x: number; y: number };
		perAnnotationOffset: Partial<Record<number, { x: number; y: number }>>;
		constrainToViewport: boolean;
		viewportPadding: number;
		buttonToDescGap: number;
	};
	private rendererDomElement: HTMLCanvasElement;

	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private signObjects: THREE.Object3D[];
	private fallbackPositions: { x: number; y: number; z: number }[];

	constructor(params: AnnotationsParams) {
		this.scene = params.scene;
		this.camera = params.camera;
		this.signObjects = params.signObjects;
		this.fallbackPositions = params.fallbackPositions ?? [];
		this.rendererDomElement = params.rendererDomElement;
		this.mobilePositioning = {
			breakpoint: params.mobilePositioning?.breakpoint ?? 1440,
			globalOffset: params.mobilePositioning?.globalOffset ?? { x: 0, y: 0 },
			perAnnotationOffset: params.mobilePositioning?.perAnnotationOffset ?? {},
			constrainToViewport: params.mobilePositioning?.constrainToViewport ?? false,
			viewportPadding: params.mobilePositioning?.viewportPadding ?? 10,
			buttonToDescGap: params.mobilePositioning?.buttonToDescGap ?? 12
		};

		this.setup();
	}

	private setup(): void {
		if (this.signObjects.length === 0 && this.fallbackPositions.length === 0) {
			return;
		}

		this.annotationOverlay = document.createElement('div');
		Object.assign(this.annotationOverlay.style, {
			position: 'fixed',
			top: '0',
			left: '0',
			width: '0',
			height: '0',
			overflow: 'visible',
			pointerEvents: 'none',
			zIndex: '20',
			mixBlendMode: 'normal',
			isolation: 'isolate'
		});
		document.body.appendChild(this.annotationOverlay);
		this.smokeTransitionUnsubscribe = fullScreenSmokeTransition.subscribe((state) => {
			this.isSmokeTransitionActive = state.active;

			if (!this.annotationOverlay) return;

			this.annotationOverlay.style.opacity = state.active ? '0' : '1';
			this.annotationOverlay.style.visibility = state.active ? 'hidden' : 'visible';
		});

		// Create annotations based on Sign objects positions, initially hidden (shown at Scene_07)
		this.createAnnotations();
		this._annotationPositionsDirty = true;
	}

	private createAnnotations(): void {
		const count = Math.max(
			this.signObjects.length,
			this.fallbackPositions.length,
			vacancies.length
		);

		// Force update world matrices before getting positions
		this.scene.updateMatrixWorld(true);

		for (let vacancyIndex = 0; vacancyIndex < count; vacancyIndex++) {
			const vacancy = vacancies[vacancyIndex];
			if (!vacancy) continue;

			let position: { x: number; y: number; z: number };

			if (this.signObjects[vacancyIndex]) {
				const worldPos = new THREE.Vector3();
				this.signObjects[vacancyIndex].getWorldPosition(worldPos);
				position = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
			} else if (this.fallbackPositions[vacancyIndex]) {
				position = this.fallbackPositions[vacancyIndex];
			} else {
				continue;
			}

			const element = document.createElement('div');
			element.innerHTML = this.createAnnotationHTML(vacancy, vacancyIndex);
			element.style.pointerEvents = 'auto';
			element.addEventListener('click', (event) => {
				event.stopPropagation();
				this.setActiveAnnotation(vacancyIndex);
			});

			this.annotationEntries.set(String(vacancyIndex), {
				element,
				position,
				visible: false,
				desc: element.querySelector('.hotspot__desc'),
				lastMagnetX: 0
			});

			this.annotationElements[vacancyIndex] = element;
			Object.assign(element.style, {
				position: 'absolute',
				top: '0',
				left: '0',
				display: 'none',
				willChange: 'transform'
			});
			this.annotationOverlay?.appendChild(element);
		}
	}

	private createAnnotationHTML(vacancy: (typeof vacancies)[number], index: number): string {
		const isLeft = vacancy.textPosition === 'left';
		const buttonId = `hotspot-trigger-${index}`;
		const contentId = `hotspot-content-${index}`;

		return `
    <div class="hotspot${isLeft ? ' hotspot--left' : ''}" data-index="${index}">
        <button
            id="${buttonId}"
            class="hotspot__btn"
            type="button"
            aria-label="${vacancy.title}"
            aria-controls="${contentId}"
            aria-expanded="false"
        >
            <svg viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 0H6V11H5V0Z" fill="currentColor" />
                <path d="M4.3714e-08 6L0 5L11 5V6L4.3714e-08 6Z" fill="currentColor" />
                <path
                    d="M3.37891 5.5L5.50023 3.37868L7.62155 5.5L5.50023 7.62132L3.37891 5.5Z"
                    fill="currentColor"
                />
            </svg>
        </button>

        <div class="hotspot__desc">
            <div class="hotspot__summary">
                <h6 class="hotspot__title">
                    <span>${vacancy.title}</span>
                    <span class="info-mask"><span class="info">(Click to Read)</span></span>
                </h6>
            </div>
            <div
                id="${contentId}"
                class="hotspot__content"
                role="region"
                aria-labelledby="${buttonId}"
                aria-hidden="true"
            >
                <div class="hotspot__content-mask">
                    <div class="hotspot__content-inner">
                        <h6 class="hotspot__title">${vacancy.title}</h6>
                        <p class="desc">${vacancy.description}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;
	}

	private setActiveAnnotation(index: number): void {
		const previousIndex = this.activeAnnotationIndex;
		const nextIndex = previousIndex === index ? -1 : index;

		if (previousIndex !== -1) {
			this.setAnnotationExpanded(previousIndex, false, true);
		}

		this.activeAnnotationIndex = nextIndex;
		if (nextIndex !== -1) {
			this.setAnnotationExpanded(nextIndex, true, true);
		}
	}

	private resetAnnotationStates(): void {
		if (this.activeAnnotationIndex !== -1) {
			this.setAnnotationExpanded(this.activeAnnotationIndex, false, false);
		}
		this.activeAnnotationIndex = -1;
	}

	private setAnnotationExpanded(index: number, expanded: boolean, animate: boolean): void {
		const element = this.annotationElements[index];
		if (!element) return;

		const hotspot = element.querySelector<HTMLElement>('.hotspot');
		const button = element.querySelector<HTMLButtonElement>('.hotspot__btn');
		const content = element.querySelector<HTMLElement>('.hotspot__content');
		hotspot?.classList.toggle('hotspot--active', expanded);
		button?.setAttribute('aria-expanded', String(expanded));
		content?.setAttribute('aria-hidden', String(!expanded));

		const timeline = this.getOpenTimeline(index);
		if (!timeline) return;

		if (!animate) {
			timeline.setProgress(expanded ? 1 : 0);
			return;
		}

		if (expanded) {
			timeline.play();
		} else {
			timeline.reverse();
		}
	}

	private getOpenTimeline(index: number): AnimationTimeline | null {
		const existing = this.annotationOpenTimelines.get(index);
		if (existing) return existing;

		const element = this.annotationElements[index];
		if (!element) return null;
		const timeline = createAnnotationOpenTimeline(element);
		if (!timeline) return null;

		this.annotationOpenTimelines.set(index, timeline);
		return timeline;
	}

	private playRevealForIndex(index: number): void {
		this.cancelHideForIndex(index);
		const element = this.annotationElements[index];
		if (!element) return;

		let timeline = this.annotationRevealTimelines.get(index);
		if (!timeline) {
			timeline = createAnnotationRevealTimeline(element) ?? undefined;
			if (!timeline) return;
			this.annotationRevealTimelines.set(index, timeline);
		}

		this.getOpenTimeline(index);
		timeline.play(true);
	}

	private stopRevealForIndex(index: number): void {
		this.cancelHideForIndex(index);
		const timeline = this.annotationRevealTimelines.get(index);
		if (!timeline) return;
		timeline.destroy();
		this.annotationRevealTimelines.delete(index);
	}

	private cancelHideForIndex(index: number): void {
		const timeoutId = this.hideAnimationTimeouts.get(index);
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
			this.hideAnimationTimeouts.delete(index);
		}
		this.hidingIndices.delete(index);
		this.pendingHideIndices.delete(index);
	}

	private hasActiveHideTransitions(): boolean {
		return this.hidingIndices.size > 0 || this.pendingHideIndices.size > 0;
	}

	private playHideForIndex(index: number): void {
		if (this.hidingIndices.has(index)) return;
		const entry = this.annotationEntries.get(String(index));
		if (!entry) return;
		const element = this.annotationElements[index];
		if (!element) {
			entry.visible = false;
			return;
		}

		let timeline = this.annotationRevealTimelines.get(index);
		if (!timeline) {
			timeline = createAnnotationRevealTimeline(element) ?? undefined;
			if (timeline) {
				this.annotationRevealTimelines.set(index, timeline);
			}
		}

		if (!timeline) {
			entry.visible = false;
			this._annotationPositionsDirty = true;
			return;
		}

		this.hidingIndices.add(index);
		timeline.setProgress(1);
		timeline.reverse();

		const timeoutId = window.setTimeout(
			() => {
				const latest = this.annotationEntries.get(String(index));
				if (latest) {
					latest.visible = false;
				}
				this.hidingIndices.delete(index);
				this.hideAnimationTimeouts.delete(index);
				this._annotationPositionsDirty = true;
			},
			Math.max(0, timeline.duration) + 30
		);
		this.hideAnimationTimeouts.set(index, timeoutId);
	}

	public updateForProgress(normalizedProgress: number): void {
		if (this.annotationEntries.size === 0) return;

		const viewportWidth = this.rendererDomElement.clientWidth || window.innerWidth;
		const isMobileViewport = viewportWidth < 768;
		const annotationRange = getScene07AnnotationRange(viewportWidth);
		const sceneRange = annotationRange.end - annotationRange.start;
		const visibilityEnd = isMobileViewport
			? Math.max(
					annotationRange.start,
					annotationRange.end - sceneRange * annotationVisibilityEndTrimMobile
				)
			: annotationRange.end;
		const shouldShowAnnotations =
			normalizedProgress >= annotationRange.start && normalizedProgress < visibilityEnd;
		const localSceneProgress =
			sceneRange > 0 ? (normalizedProgress - annotationRange.start) / sceneRange : 0;

		if (shouldShowAnnotations !== this.lastAnnotationVisibility) {
			this.lastAnnotationVisibility = shouldShowAnnotations;
			this._annotationPositionsDirty = true;
		}

		if (shouldShowAnnotations) {
			const shouldHideFirstAnnotation = localSceneProgress >= firstAnnotationHideAtProgress;
			let activeAnnotationStillVisible = false;
			for (const [id, entry] of this.annotationEntries.entries()) {
				const index = Number(id);
				const revealAt = this.getResponsiveRevealProgress(index, viewportWidth);
				const isVisible =
					index === 0
						? localSceneProgress >= revealAt && !shouldHideFirstAnnotation
						: localSceneProgress >= revealAt;
				const wasVisible = entry.visible;
				const isHiding = this.hidingIndices.has(index);

				if (isVisible) {
					entry.visible = true;
					if (isHiding) {
						this.cancelHideForIndex(index);
						this.playRevealForIndex(index);
					} else if (!wasVisible) {
						this.cancelHideForIndex(index);
						this.pendingRevealIndices.add(index);
					}
				} else if (isHiding) {
					// Keep element visible while reverse animation runs.
					entry.visible = true;
				} else if (wasVisible) {
					// Start hide animation; visibility switches to false on hide completion.
					entry.visible = true;
					this.pendingHideIndices.add(index);
					this.pendingRevealIndices.delete(index);
				} else {
					entry.visible = false;
				}

				if (index === this.activeAnnotationIndex && (isVisible || this.hidingIndices.has(index))) {
					activeAnnotationStillVisible = true;
				}
			}
			if (this.activeAnnotationIndex !== -1 && !activeAnnotationStillVisible) {
				this.resetAnnotationStates();
			}
		} else {
			if (this.activeAnnotationIndex !== -1) {
				this.resetAnnotationStates();
			}
			for (const [id, entry] of this.annotationEntries.entries()) {
				const index = Number(id);
				if (entry.visible && !this.hidingIndices.has(index)) {
					// Keep visible for reverse playback; becomes false in playHideForIndex completion.
					this.pendingHideIndices.add(index);
				}
			}
			this.pendingRevealIndices.clear();
		}

		// Track visibility for conditional CSS rendering in render()
		const wasVisible = this._annotationsVisible;
		this._annotationsVisible = shouldShowAnnotations || this.hasActiveHideTransitions();
		if (wasVisible !== this._annotationsVisible) {
			this._annotationsNeedFinalRender = true;
		}
		this._annotationPositionsDirty = true;
	}

	public render(): void {
		if (this._annotationsVisible) {
			this._annotationPositionsDirty = true;
		}
		if (
			this.annotationEntries.size > 0 &&
			(this._annotationPositionsDirty || this._annotationsNeedFinalRender)
		) {
			this.updateAnnotationPositions();
			this._annotationPositionsDirty = false;
			this._annotationsNeedFinalRender = false;
		}
	}

	private getResponsiveRevealProgress(index: number, viewportWidth: number): number {
		if (viewportWidth < 768) {
			return annotationRevealAtProgressMobile[index] ?? 1;
		}
		const baseRevealProgress = annotationRevealAtProgressDesktop[index] ?? 1;
		if (viewportWidth < 1440) {
			return Math.max(0, baseRevealProgress - 0.08);
		}
		return baseRevealProgress;
	}

	private updateAnnotationPositions(): void {
		if (this.annotationEntries.size === 0) return;

		if (this.isSmokeTransitionActive) {
			for (const entry of this.annotationEntries.values()) {
				entry.element.style.display = 'none';
			}
			return;
		}

		const bounds = this.rendererDomElement.getBoundingClientRect();
		const left = bounds.left;
		const top = bounds.top;
		const w = Math.max(1, Math.round(bounds.width));
		const h = Math.max(1, Math.round(bounds.height));
		const isMobile = window.innerWidth < this.mobilePositioning.breakpoint;

		for (const [id, entry] of this.annotationEntries.entries()) {
			const index = Number(id);
			const element = entry.element;

			if (!entry.visible || !this._annotationsVisible) {
				element.style.display = 'none';
				continue;
			}

			// Anchor to the sign's *live* world position each frame. The signs are
			// part of the animated model ("positioned at the last step of the
			// timeline"), so the world position captured once at load (rest pose, in
			// createAnnotations) is stale by the time the annotation shows in
			// Scene_07 — the dot drifts off the sign as it rotates/translates into
			// place. getWorldPosition refreshes the world matrix internally, so it
			// reflects the current animated transform. Fall back to the cached
			// position only for fallback-positioned entries (no sign object).
			const signObject = this.signObjects[index];
			if (signObject) {
				signObject.getWorldPosition(this._annotationWorldPos);
				this._annotationNdc.copy(this._annotationWorldPos).project(this.camera);
			} else {
				this._annotationNdc
					.set(entry.position.x, entry.position.y, entry.position.z)
					.project(this.camera);
			}

			if (this._annotationNdc.z >= 1) {
				element.style.display = 'none';
				continue;
			}

			let x = Math.round((this._annotationNdc.x * 0.5 + 0.5) * w + left);
			let y = Math.round((-this._annotationNdc.y * 0.5 + 0.5) * h + top);

			element.style.display = '';
			if (index === this.activeAnnotationIndex && !this.annotationOpenTimelines.has(index)) {
				this.getOpenTimeline(index)?.setProgress(1);
			}

			if (isMobile) {
				const offset = this.mobilePositioning.perAnnotationOffset[index] ?? { x: 0, y: 0 };
				x += this.mobilePositioning.globalOffset.x + offset.x;
				y += this.mobilePositioning.globalOffset.y + offset.y;

				if (this.mobilePositioning.constrainToViewport) {
					const btn = element.querySelector('.hotspot__btn') as HTMLElement | null;
					const desc = element.querySelector('.hotspot__desc') as HTMLElement | null;
					const btnWidth = btn?.offsetWidth ?? 42;
					const descWidth = desc?.offsetWidth ?? 0;
					const descHeight = desc?.offsetHeight ?? 0;

					if (descWidth > 0) {
						const centerX = x + btnWidth / 2;
						const minCenterX = this.mobilePositioning.viewportPadding + descWidth / 2;
						const maxCenterX =
							window.innerWidth - this.mobilePositioning.viewportPadding - descWidth / 2;
						const clampedCenterX = Math.min(maxCenterX, Math.max(minCenterX, centerX));
						x = Math.round(x + (clampedCenterX - centerX));
					}

					if (descHeight > 0) {
						const bottomOverflow =
							y +
							btnWidth +
							this.mobilePositioning.buttonToDescGap +
							descHeight +
							this.mobilePositioning.viewportPadding -
							window.innerHeight;
						if (bottomOverflow > 0) {
							y = Math.max(this.mobilePositioning.viewportPadding, Math.round(y - bottomOverflow));
						}
					}
				}
			}

			element.style.transform = `translate(${x}px,${y}px)`;

			// Auto-offset is opened-only: a closed tooltip stays snug to its dot
			// (magnet 0, may scroll off-screen with its 3D anchor); the opened panel
			// is clamped inside the viewport so it never clips while being read, even
			// as the camera orbits the tree and the dot swings across the screen.
			// Only `.hotspot__desc` moves, via `--hotspot-magnet-x`; its natural box
			// is recovered by removing the offset applied last frame.
			const descEl = entry.desc;
			if (descEl) {
				let dx = 0;
				if (index === this.activeAnnotationIndex) {
					const descRect = descEl.getBoundingClientRect();
					if (descRect.width > 0) {
						const naturalLeft = descRect.left - entry.lastMagnetX;
						const naturalRight = descRect.right - entry.lastMagnetX;
						dx = Math.round(axisClamp(naturalLeft, naturalRight, window.innerWidth));
					} else {
						dx = entry.lastMagnetX;
					}
				}
				if (dx !== entry.lastMagnetX) {
					descEl.style.setProperty('--hotspot-magnet-x', `${dx}px`);
					entry.lastMagnetX = dx;
				}
			}

			if (this.pendingRevealIndices.has(index)) {
				this.playRevealForIndex(index);
				this.pendingRevealIndices.delete(index);
			}
			if (this.pendingHideIndices.has(index)) {
				this.playHideForIndex(index);
				this.pendingHideIndices.delete(index);
			}
		}
	}

	public resize(width: number, height: number): void {
		void width;
		void height;
		for (const timeline of this.annotationOpenTimelines.values()) {
			timeline.destroy();
		}
		this.annotationOpenTimelines.clear();
		if (this.activeAnnotationIndex !== -1) {
			this.getOpenTimeline(this.activeAnnotationIndex)?.setProgress(1);
		}
		this._annotationPositionsDirty = true;
		this._annotationsNeedFinalRender = true;
	}

	public destroy(): void {
		for (const timeoutId of this.hideAnimationTimeouts.values()) {
			window.clearTimeout(timeoutId);
		}
		this.hideAnimationTimeouts.clear();
		for (const index of this.annotationRevealTimelines.keys()) {
			this.stopRevealForIndex(index);
		}
		for (const timeline of this.annotationOpenTimelines.values()) {
			timeline.destroy();
		}
		this.annotationOpenTimelines.clear();
		this.pendingRevealIndices.clear();
		this.pendingHideIndices.clear();
		this.hidingIndices.clear();
		this.smokeTransitionUnsubscribe?.();
		this.smokeTransitionUnsubscribe = undefined;

		this.annotationEntries.clear();

		if (this.annotationOverlay?.parentNode) {
			this.annotationOverlay.parentNode.removeChild(this.annotationOverlay);
			this.annotationOverlay = undefined;
		}

		this.annotationElements = [];
	}
}
