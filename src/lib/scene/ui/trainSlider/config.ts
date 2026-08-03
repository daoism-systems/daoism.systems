import { SLIDES } from '../slideData';
import type { GraphicsTier } from '../../GraphicsConfig';

export type ResolvedSliderProps = {
	aspect: number;
	slideCount: number;
	planeWidth: number;
	planeHeight: number;
	spacing: number;
	mobileClickHint: boolean;
};

export type SliderConfig = {
	harmonicaBands: number;
	harmonicaSpeed: number;
	harmonicaAmplitude: number;
	harmonicaFrequency: number;
	harmonicaRadius: number;
	harmonicaCenterX: number;
	harmonicaSmoothness: number;
	curveStrength: number;
	curveFrequency: number;
	curveMaxCurve: number;
	curveDamping: number;
	curveYInfluence: number;
	exit: SliderExitConfig;
};

export type SliderExitConfig = {
	progressStart: number;
	distance: number;
};

export type SliderDebugValues = {
	progress: number;
	exitProgress: number;
	velocity: number;
	smoothedVelocity: number;
	activeSlide: number;
};

export type PerformancePreset = {
	geometrySegments: { width: number; height: number };
	config: Partial<Omit<SliderConfig, 'harmonicaCenterX' | 'exit'>> & {
		exit?: Partial<SliderExitConfig>;
	};
};

export const DEFAULT_SLIDER_EXIT_CONFIG: SliderExitConfig = {
	progressStart: 0.72,
	distance: 40
};

export const DEFAULT_SLIDER_CONFIG: SliderConfig = {
	harmonicaBands: 12,
	harmonicaSpeed: 1.0,
	harmonicaAmplitude: 0.03,
	harmonicaFrequency: 1.0,
	harmonicaRadius: 10.0,
	harmonicaCenterX: 0,
	harmonicaSmoothness: 2.0,
	curveStrength: 10.0,
	curveFrequency: 10.0,
	curveMaxCurve: 4.0,
	curveDamping: 0.85,
	curveYInfluence: 0.9,
	exit: { ...DEFAULT_SLIDER_EXIT_CONFIG }
};

export const PERFORMANCE_PRESETS: Record<GraphicsTier, PerformancePreset> = {
	high: {
		geometrySegments: { width: 32, height: 16 },
		config: {
			harmonicaBands: 12,
			harmonicaSpeed: 1.0,
			harmonicaAmplitude: 0.03,
			harmonicaFrequency: 1.0,
			harmonicaRadius: 10.0,
			harmonicaSmoothness: 2.0,
			curveStrength: 10.0,
			curveFrequency: 10.0,
			curveMaxCurve: 4.0,
			curveDamping: 0.85,
			curveYInfluence: 0.9
		}
	},
	medium: {
		geometrySegments: { width: 16, height: 8 },
		config: {
			harmonicaBands: 8,
			harmonicaSpeed: 0.9,
			harmonicaAmplitude: 0.025,
			harmonicaFrequency: 0.8,
			harmonicaRadius: 9.0,
			harmonicaSmoothness: 2.0,
			curveStrength: 7.5,
			curveFrequency: 6.0,
			curveMaxCurve: 3.5,
			curveDamping: 0.88,
			curveYInfluence: 0.8
		}
	},
	low: {
		geometrySegments: { width: 8, height: 4 },
		config: {
			harmonicaBands: 4,
			harmonicaSpeed: 0.7,
			harmonicaAmplitude: 0.018,
			harmonicaFrequency: 0.6,
			harmonicaRadius: 8.0,
			harmonicaSmoothness: 2.0,
			curveStrength: 5.5,
			curveFrequency: 4.0,
			curveMaxCurve: 3.0,
			curveDamping: 0.9,
			curveYInfluence: 0.7
		}
	}
};

export const PHONE_MAX_WIDTH = 768;
export const TABLET_MAX_WIDTH = 1024;

export function getViewportScale(viewportWidth: number): number {
	if (!viewportWidth || viewportWidth > TABLET_MAX_WIDTH) return 1;
	if (viewportWidth < 420) return 0.34;
	if (viewportWidth < 560) return 0.42;
	return 0.62;
}

export function getMobileCurveScale(viewportWidth: number): number {
	if (!viewportWidth || viewportWidth > TABLET_MAX_WIDTH) return 1;
	if (viewportWidth < 420) return 0.4;
	if (viewportWidth < 560) return 0.46;
	if (viewportWidth < PHONE_MAX_WIDTH) return 0.52;
	return 0.58;
}

export function resolveSliderProps(params: {
	aspect: number;
	planeWidth: number;
	planeHeight?: number;
	spacing: number;
	mobileClickHint: boolean;
	viewportWidth: number;
}): ResolvedSliderProps {
	const mobileScale = getViewportScale(params.viewportWidth);
	const basePlaneHeight = params.planeHeight ?? params.planeWidth / params.aspect;
	const effectivePlaneWidth = params.planeWidth * mobileScale;
	const effectivePlaneHeight = basePlaneHeight * mobileScale;
	return {
		aspect: effectivePlaneWidth / effectivePlaneHeight,
		slideCount: SLIDES.length,
		planeWidth: effectivePlaneWidth,
		planeHeight: effectivePlaneHeight,
		spacing: params.spacing,
		mobileClickHint: params.mobileClickHint
	};
}
