export interface ResizeInfo {
	width: number;
	height: number;
	/**
	 * On mobile, this stays at the cached `stableHeight` during URL-bar toggles
	 * so the camera FOV doesn't re-jitter as the address bar collapses/expands.
	 * On desktop or on width-changing resizes, this equals `height`.
	 */
	layoutHeight: number;
	isUrlBarToggle: boolean;
}

export type ResizeHandler = (info: ResizeInfo) => void;

/**
 * Owns window resize debouncing and responsive breakpoint queries. Hosts wire
 * up a single `start(onResize)` callback that fans out to every subsystem
 * needing resize work; the `getCameraFov` / `getOctagonOffsetY` queries are
 * available at any time for setup-phase use (camera construction, initial
 * particle world offset, etc.).
 */
export class ResponsiveLayout {
	private lastWindowWidth = 0;
	private stableHeight = 0;
	private resizeRafId: number | null = null;
	private pendingResize = { width: 0, height: 0 };
	private handler: ResizeHandler | null = null;

	constructor(private readonly isMobile: boolean) {}

	public start(onResize: ResizeHandler): void {
		this.handler = onResize;
		this.lastWindowWidth = window.innerWidth;
		this.stableHeight = window.innerHeight;
		window.addEventListener('resize', this.onWindowResize, { passive: true });
	}

	public stop(): void {
		window.removeEventListener('resize', this.onWindowResize);
		if (this.resizeRafId !== null) {
			cancelAnimationFrame(this.resizeRafId);
			this.resizeRafId = null;
		}
		this.handler = null;
	}

	public getCameraFov(width: number = window.innerWidth): number {
		if (width > 1024) return 22.89;
		if (width > 768) return 30;
		return 33;
	}

	public getOctagonOffsetY(width: number = window.innerWidth): number {
		return width > 768 ? 0 : 0.5;
	}

	private onWindowResize = (): void => {
		this.pendingResize.width = window.innerWidth;
		this.pendingResize.height = window.innerHeight;
		if (this.resizeRafId !== null) return;
		this.resizeRafId = requestAnimationFrame(() => {
			this.resizeRafId = null;
			this.applyResize(this.pendingResize.width, this.pendingResize.height);
		});
	};

	private applyResize(width: number, height: number): void {
		const widthChanged = width !== this.lastWindowWidth;
		if (widthChanged || !this.isMobile) {
			this.stableHeight = height;
		}
		this.lastWindowWidth = width;
		const isUrlBarToggle = this.isMobile && !widthChanged;
		const layoutHeight = this.isMobile ? this.stableHeight : height;

		this.handler?.({ width, height, layoutHeight, isUrlBarToggle });
	}
}
