import * as THREE from 'three/webgpu';
import type Renderer from './Renderer';

function addUniformControl(
	folder: any,
	uniformNode: any,
	label: string,
	min: number,
	max: number,
	step = 0.01,
	onChange?: (value: number) => void
): void {
	if (!uniformNode || typeof uniformNode.value !== 'number') return;
	folder
		.add(uniformNode, 'value', min, max, step)
		.name(label)
		.onChange((value: number) => {
			uniformNode.value = Number(value);
			onChange?.(Number(value));
		});
}

export function setupRendererInspectorControls(
	renderer: Renderer,
	inspectorInstance: any,
	scene?: THREE.Scene
): any {
	const hdrGui = inspectorInstance.createParameters('HDR');
	hdrGui.close();
	hdrGui.add(renderer, 'toneMappingExposure', 0, 5, 0.01).name('Exposure');

	const toneMappingOptions = {
		NoToneMapping: THREE.NoToneMapping,
		LinearToneMapping: THREE.LinearToneMapping,
		ReinhardToneMapping: THREE.ReinhardToneMapping,
		CineonToneMapping: THREE.CineonToneMapping,
		ACESFilmicToneMapping: THREE.ACESFilmicToneMapping,
		NeutralToneMapping: THREE.NeutralToneMapping
	};

	const toneMappingParams = { toneMapping: renderer.toneMapping };

	hdrGui
		.add(toneMappingParams, 'toneMapping', toneMappingOptions)
		.name('Tone Mapping')
		.onChange((value: THREE.ToneMapping) => {
			renderer.toneMapping = value;
			renderer.domElement.style.imageRendering = 'auto';
			renderer.getPostProcessing().needsUpdate = true;
		});

	const colorSpaceOptions = {
		SRGBColorSpace: THREE.SRGBColorSpace,
		LinearSRGBColorSpace: THREE.LinearSRGBColorSpace,
		NoColorSpace: THREE.NoColorSpace
	};

	const colorSpaceParams = { outputColorSpace: renderer.outputColorSpace };

	hdrGui
		.add(colorSpaceParams, 'outputColorSpace', colorSpaceOptions)
		.name('Output Color Space')
		.onChange((value: string) => {
			renderer.outputColorSpace = value;
			renderer.getPostProcessing().needsUpdate = true;
		});

	const gui = inspectorInstance.createParameters('Post Processing');
	gui.close();
	renderer.setPostProcessingPanel(gui);

	const refs = renderer.getRefs();
	const fogFolder = gui.addFolder('Fog');

	const sceneFog = scene?.fog as THREE.FogExp2 | undefined;
	if (sceneFog) {
		fogFolder.add(sceneFog, 'density', 0, 0.2, 0.001).name('scene fog density');
		fogFolder.addColor(sceneFog, 'color').name('scene fog color');
	}

	const transitionFolder = gui.addFolder('Transition');
	if (refs.cloudTransitionProgress) {
		const transitionDebug = {
			progress: refs.cloudTransitionProgress.value ?? 0
		};
		transitionFolder
			.add(transitionDebug, 'progress', 0, 1, 0.001)
			.name('progress')
			.onChange((value: number) => renderer.setCloudTransitionFillProgress(Number(value)));
		transitionFolder
			.add({ bypass: transitionDebug.progress === 0 }, 'bypass')
			.name('bypass')
			.onChange((enabled: boolean) => {
				if (!enabled) return;
				renderer.setCloudTransitionFillProgress(0);
			});
	}
	if (refs.proceduralLook?.caStrength) {
		addUniformControl(
			transitionFolder,
			refs.proceduralLook.caStrength,
			'procedural ca',
			0,
			0.5,
			0.001
		);
	}
	if (refs.swarmLook?.caStrength) {
		addUniformControl(
			transitionFolder,
			refs.swarmLook.caStrength,
			'swarm ca',
			0,
			0.5,
			0.001
		);
	}

	return gui;
}
