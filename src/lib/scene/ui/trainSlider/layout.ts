import * as THREE from 'three';
import type { ResolvedSliderProps, SliderExitConfig } from './config';

export type FocusUniform = { value: number };

export type SlideMeshLike = {
	position: THREE.Vector3;
	rotation: THREE.Euler;
	scale: THREE.Vector3;
	renderOrder: number;
	userData: {
		focusUniform: FocusUniform;
	};
};

export function getSlideFocusState(index: number, visualIndex: number, focusFalloff: number) {
	const distanceFromFocus = index - visualIndex;
	const absDistance = Math.abs(distanceFromFocus);
	const rawFocus = Math.max(0, 1 - absDistance / focusFalloff);
	return {
		focus: THREE.MathUtils.smoothstep(rawFocus, 0, 1),
		softenedDistance: Math.sign(distanceFromFocus) * Math.pow(absDistance, 0.94)
	};
}

export function updateSlideFocusUniform(
	focusUniform: FocusUniform,
	focus: number,
	force: boolean,
	focusUniformLerp: number
): void {
	focusUniform.value = force
		? focus
		: THREE.MathUtils.lerp(focusUniform.value, focus, focusUniformLerp);
}

export function updateSlideTransforms(params: {
	slides: SlideMeshLike[];
	props: ResolvedSliderProps;
	currentVisualIndex: number;
	slideStepMultiplier: number;
	inactiveSlideScale: number;
	activeSlideScale: number;
	activeSlideYOffset: number;
	activeSlideZOffset: number;
	focusUniformLerp: number;
	exitProgress: number;
	exit: SliderExitConfig;
	force?: boolean;
}): void {
	const unitWidth = (params.props.planeWidth + params.props.spacing) * params.slideStepMultiplier;
	const focusFalloff = 1.24;
	const exitProgress = THREE.MathUtils.clamp(params.exitProgress, 0, 1);
	const exit = params.exit;

	const exitOffsetX = -exit.distance * exitProgress;

	params.slides.forEach((slide, index) => {
		const { focus, softenedDistance } = getSlideFocusState(
			index,
			params.currentVisualIndex,
			focusFalloff
		);
		const scale = THREE.MathUtils.lerp(params.inactiveSlideScale, params.activeSlideScale, focus);
		const baseX = softenedDistance * unitWidth;
		const baseY = -0.3 + focus * params.activeSlideYOffset;
		const baseZ = focus * params.activeSlideZOffset;

		slide.position.x = baseX + exitOffsetX;
		slide.position.y = baseY;
		slide.position.z = baseZ;
		slide.rotation.set(0, 0, 0);
		slide.scale.setScalar(scale);
		slide.renderOrder = 1000 + Math.round(focus * 100);

		updateSlideFocusUniform(
			slide.userData.focusUniform,
			focus,
			params.force ?? false,
			params.focusUniformLerp
		);
	});
}
