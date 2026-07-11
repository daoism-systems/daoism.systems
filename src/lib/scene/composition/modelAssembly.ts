import * as THREE from 'three/webgpu';
import { SharedMaterials } from '../materials/SharedMaterials';

export interface SceneModelObjects {
	octagonGroup: THREE.Object3D | undefined;
	cubesObject: THREE.Object3D | undefined;
	cubesGroup: THREE.Object3D | null;
	pyramidsGroup: THREE.Object3D | null;
	forestGroup: THREE.Object3D | null;
	/** Hero tree (BIG_TREEE_1) — the one carrying the signs. */
	forestMainTreeGroup: THREE.Object3D | null;
	/** Remaining forest trees (BIG_TREEE, BIG_TREEE_2, Trees). */
	forestOtherTreeGroups: THREE.Object3D[];
	/** City buildings (City). */
	forestCityGroup: THREE.Object3D | null;
	modelCamera: THREE.Object3D | null;
	signObjects: THREE.Object3D[];
}

export const DEFAULT_ANNOTATION_FALLBACK_POSITIONS = [
	{ x: -1.933, y: -18.1951, z: -11.9296 },
	{ x: 0.6977, y: -17.4587, z: -17.71 },
	{ x: -0.6874, y: -16.2667, z: -17.0279 }
] as const;

export const DEFAULT_ANNOTATION_MOBILE_POSITIONING = {
	breakpoint: 1440,
	globalOffset: { x: 0, y: 0 },
	perAnnotationOffset: {
		0: { x: 50, y: 0 },
		1: { x: 160, y: 0 },
		2: { x: -160, y: 0 }
	},
	constrainToViewport: false,
	viewportPadding: 10,
	buttonToDescGap: 12
} as const;

export function disableMeshShadows(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (obj instanceof THREE.Mesh) {
			obj.castShadow = false;
			obj.receiveShadow = false;
		}
	});
}

export function resolveSceneModelObjects(root: THREE.Object3D): SceneModelObjects {
	const signObjects = ['Sign', 'Sign_02', 'Sign_03']
		.map((name) => root.getObjectByName(name))
		.filter((obj): obj is THREE.Object3D => obj !== undefined && obj !== null);

	// Forest decomposed so its sub-groups can be shown/hidden independently
	// (Theatre's `Visibility` object). Direct children of `Forest` are exactly
	// BIG_TREEE, BIG_TREEE_1, BIG_TREEE_2, City and Trees, so these three
	// buckets cover the whole group with no overlap.
	const forestGroup = root.getObjectByName('Forest') || null;
	const forestOtherTreeGroups = ['BIG_TREEE', 'BIG_TREEE_2', 'Trees']
		.map((name) => forestGroup?.getObjectByName(name) ?? null)
		.filter((obj): obj is THREE.Object3D => obj !== null);

	return {
		octagonGroup: root.getObjectByName('Octagon_') || root.getObjectByName('Octagon') || undefined,
		cubesObject: root.getObjectByName('Sausages') || undefined,
		cubesGroup: root.getObjectByName('Cubes_scn_02') || null,
		pyramidsGroup: root.getObjectByName('pyramids_1') || root.getObjectByName('Pyramids') || null,
		forestGroup,
		forestMainTreeGroup: forestGroup?.getObjectByName('BIG_TREEE_1') ?? null,
		forestOtherTreeGroups,
		forestCityGroup: forestGroup?.getObjectByName('City') ?? null,
		modelCamera:
			root.getObjectByName('Full_Camera') || root.getObjectByName('Full_Camera_01') || null,
		signObjects
	};
}

export function applyInitialModelCamera(
	camera: THREE.PerspectiveCamera,
	modelCamera: THREE.Object3D | null
): void {
	if (!modelCamera) {
		return;
	}

	const worldPos = modelCamera.getWorldPosition(new THREE.Vector3());
	const worldQuat = modelCamera.getWorldQuaternion(new THREE.Quaternion());

	camera.position.copy(worldPos);
	camera.quaternion.copy(worldQuat);
	camera.updateProjectionMatrix();
}

export function isDescendantOf(obj: THREE.Object3D, ancestorName: string): boolean {
	let parent = obj.parent;
	while (parent) {
		if (parent.name === ancestorName) {
			return true;
		}
		parent = parent.parent;
	}
	return false;
}

export function isPyramidObject(obj: THREE.Object3D): boolean {
	return (
		obj.name === 'Pyramids' ||
		/pyramid/i.test(obj.name) ||
		isDescendantOf(obj, 'pyramids_1') ||
		isDescendantOf(obj, 'Pyramids')
	);
}

/**
 * The only forest trees that carry particle clouds — BIG_TREEE_1 (the sign
 * tree) plus the two near foreground trees Small_tree and Small_tree_5 (see
 * ParticleOrchestrator's sign-tree branch + NEAR_FOREST_TREE_NAMES). Exact
 * node names, so Small_tree does NOT match Small_tree_1/2/7. CA/RGB-split is
 * scoped to these three so the particle trees read as the "hero" elements; the
 * remaining solid trees (and the City group) render clean.
 */
const CHROMATIC_TREE_ANCESTORS = ['BIG_TREEE_1', 'Small_tree', 'Small_tree_5'] as const;

export function isForestChromaticAberrationTarget(obj: THREE.Object3D): boolean {
	return CHROMATIC_TREE_ANCESTORS.some((name) => isDescendantOf(obj, name));
}

export function applyForestChromaticAberrationLayer(
	forestGroup: THREE.Object3D | null,
	layer: number
): void {
	if (!forestGroup) {
		return;
	}

	forestGroup.traverse((child) => {
		if (
			child instanceof THREE.Mesh &&
			!/particle/i.test(child.name) &&
			isForestChromaticAberrationTarget(child)
		) {
			child.layers.enable(layer);
		}
	});
}

export function applyModelMaterials(modelScene: THREE.Group): void {
	const whiteMaterial = SharedMaterials.getWhiteEmissiveMaterial();
	const forestTreeMaterial = SharedMaterials.getForestTreeMaterial();
	const pyramidMaterial = SharedMaterials.getPyramidMaterial();

	const processedParticleMeshes = new Set<THREE.Mesh>();

	modelScene.traverse((child) => {
		if (child.name && /particle/i.test(child.name)) {
			child.traverse((nestedChild) => {
				if (nestedChild instanceof THREE.Mesh) {
					processedParticleMeshes.add(nestedChild);
				}
			});
			if (child instanceof THREE.Mesh) {
				processedParticleMeshes.add(child);
			}
		}
	});

	modelScene.traverse((child) => {
		if (!(child instanceof THREE.Mesh) || processedParticleMeshes.has(child)) {
			return;
		}

		child.visible = true;

		if (isDescendantOf(child, 'Forest')) {
			child.material = forestTreeMaterial;
		} else if (isPyramidObject(child)) {
			child.material = pyramidMaterial;
		} else {
			child.material = whiteMaterial;
		}
	});
}
