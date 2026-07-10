import { FluidMouseField, FluidProfiles } from '../particles/FluidMouseField';

/**
 * Injects fluid splats into the global fluid field from pointer/touch motion.
 *
 * The "velocity" passed to splat() is pixelDelta / simResolution. Combined with
 * FluidProfiles.PostFx.force this matches the VFX-JS reference shader input and
 * produces v ≈ 0.1–0.5 during active motion — the range the dispersion display
 * is tuned for.
 */
export class MouseInteractions {
	private prevMouseX?: number;
	private prevMouseY?: number;
	private globalFluidEffect: FluidMouseField | null;
	private domElement: HTMLElement;

	constructor({
		globalFluidEffect,
		domElement
	}: {
		globalFluidEffect: FluidMouseField | null;
		domElement: HTMLElement;
	}) {
		this.globalFluidEffect = globalFluidEffect;
		this.domElement = domElement;
	}

	private handlePointerInteraction(clientX: number, clientY: number): void {
		const prevMouseX = this.prevMouseX ?? clientX;
		const prevMouseY = this.prevMouseY ?? clientY;
		const dxPx = clientX - prevMouseX;
		const dyPx = -(clientY - prevMouseY); // flip to y-up
		this.prevMouseX = clientX;
		this.prevMouseY = clientY;

		if (!this.globalFluidEffect) return;

		const rect = this.domElement.getBoundingClientRect();
		const uvX = (clientX - rect.left) / Math.max(1, rect.width);
		const uvY = 1 - (clientY - rect.top) / Math.max(1, rect.height);
		const res = this.globalFluidEffect.resolution;
		this.globalFluidEffect.splat(
			{ x: uvX, y: uvY },
			dxPx / res,
			dyPx / res,
			1.0,
			FluidProfiles.PostFx
		);
	}

	public onMouseMove = (event: MouseEvent): void => {
		this.handlePointerInteraction(event.clientX, event.clientY);
	};

	public onTouchStart = (event: TouchEvent): void => {
		if (event.touches.length === 0) return;
		const touch = event.touches[0];
		this.handlePointerInteraction(touch.clientX, touch.clientY);
	};

	public onTouchMove = (event: TouchEvent): void => {
		if (event.touches.length === 0) return;
		const touch = event.touches[0];
		this.handlePointerInteraction(touch.clientX, touch.clientY);
	};

	public cleanup(): void {
		window.removeEventListener('mousemove', this.onMouseMove);
		window.removeEventListener('touchstart', this.onTouchStart);
		window.removeEventListener('touchmove', this.onTouchMove);
	}
}

export default MouseInteractions;
