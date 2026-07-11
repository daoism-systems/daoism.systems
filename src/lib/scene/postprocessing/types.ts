import * as THREE from 'three/webgpu';
import type { FluidMouseField } from '../particles/FluidMouseField';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { GraphicsOptions } from '../GraphicsConfig';
import type { SceneIndex } from '../sceneLayers';
import { SCENE_LAYERS } from '../sceneLayers';

export interface RendererInitOptions {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	params: any;
	fluidEffect: FluidMouseField | null;
	ktx2Loader: KTX2Loader;
	gltfLoader: GLTFLoader;
}

// Per-pair shader look. Both pairs (procedural 1→2, swarm 2→3) run the same
// directional-smear distortion, so every field has identical meaning across
// pairs — each pair keeps its own set only so it can be tuned independently.
export interface TransitionLookParams {
	smearStrength: number;
	caStrength: number;
	maskSoftness: number;
	axisIndex: 0 | 1;
	noiseScaleX: number;
	noiseScaleY: number;
	noiseScrollSpeed: number;
	maskNoiseStrength: number;
	detailNoiseAmount: number;
	// Radial zoom-blur/CA, layered on the swarm smear only. `radialStrength` is 0
	// on the procedural look so the term is inert there; `radialOriginX/Y` are the
	// UV-space origin the streaks emanate from (default in TRANSITION_LOOK_SWARM).
	radialStrength: number;
	radialOriginX: number;
	radialOriginY: number;
	// Inner dead-zone radius (aspect-corrected): the radial streak is 0 within
	// this distance of the origin and grows OUTWARD beyond it (stronger at edges).
	radialRadius: number;
	// Horizontal stretch of the radial fan: >1 reaches further left/right (wider
	// 180° spread from a bottom-center origin); 1 keeps the aspect-correct circle.
	radialSpreadX: number;
	// Pixelation-glitch, layered on the swarm smear only. `pixelStrength` is 0 on
	// the procedural look so the term is inert there; `pixelBlockSize` is the mosaic
	// block edge (fraction of screen height; smaller ⇒ finer grid); `pixelGlitchAmount`
	// drives the per-block horizontal tear and RGB channel split.
	pixelStrength: number;
	pixelBlockSize: number;
	pixelGlitchAmount: number;
}

// Identity of a transition pair. The active pair drives the shader's branch
// selector — each pair owns its own uniform set so Theatre/Inspector edits
// to one pair don't bleed into the other.
export type TransitionPairId = 'procedural' | 'swarm';

// Per-pair uniform handles owned by PostProcessingGraph. Keys mirror
// TransitionLookParams so setTransitionLook(pair, params) is a 1:1 copy.
export type TransitionLookUniforms = {
	smearStrength: any;
	caStrength: any;
	maskSoftness: any;
	axisIndex: any;
	noiseScaleX: any;
	noiseScaleY: any;
	noiseScrollSpeed: any;
	maskNoiseStrength: any;
	detailNoiseAmount: any;
	radialStrength: any;
	radialOriginX: any;
	radialOriginY: any;
	radialRadius: any;
	radialSpreadX: any;
	pixelStrength: any;
	pixelBlockSize: any;
	pixelGlitchAmount: any;
};

export type ScenePassEntry = { pass: any; cachedLayers: THREE.Layers; emptyLayers: THREE.Layers };
export type SceneColorPass = { scenePass: any; colorNode: any; emissiveNode: any | null };
export type SceneComposition = { composed: any; bloomPass: any | null; emissiveNode: any | null };
export type ChromaticPassEntry = {
	pass: any;
	masks: {
		none: THREE.Layers;
		s1Only: THREE.Layers;
		s3Only: THREE.Layers;
		both: THREE.Layers;
	};
};

export const SCENE_CHANNELS: SceneIndex[] = [1, 2, 3];
export const SCENE_LAYER_BY_CHANNEL: Record<SceneIndex, number> = {
	1: SCENE_LAYERS.SCENE_1,
	2: SCENE_LAYERS.SCENE_2,
	3: SCENE_LAYERS.SCENE_3
};

export const DEFAULT_CHROME_TINTS = {
	red: new THREE.Vector3(1, 0, 0),
	green: new THREE.Vector3(0, 1, 0),
	blue: new THREE.Vector3(0, 0, 1)
};

export const DESKTOP_VIGNETTE_ROUNDNESS = 0.5;
// Fade-band width = outerBound - innerBound in dist² units, set directly
// (0 = razor-thin/sharp ring, larger = softer/wider fade). 0.187 reproduces the
// prior default look; the desktop timeline overrides it per keyframe.
export const DESKTOP_VIGNETTE_WIDTH = 0.187;
// Band-center radius knob (0..1). 0.5 centers the band at 0.14 dist² (the
// original hardcoded position); larger pushes the fade toward the screen center.
export const DESKTOP_VIGNETTE_CENTER = 0.5;
export const FLUID_DISABLE_FILL_START = 0.9;
export const FLUID_DISABLE_FILL_END = 0.985;

export interface PostProcessingGraphHost {
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	readonly params: any;
	readonly fluidEffect: FluidMouseField | null;
	readonly graphicsOptions: GraphicsOptions;
	readonly isMobile: boolean;
	readonly webGPURenderer: any;
	sceneInvertAmount: number;
	sceneInvertCallback: ((amount: number) => void) | null;
	getOverlayCompositor(): ((background: any) => any) | null;
	feedbackPrevTexture: any | null;
}
