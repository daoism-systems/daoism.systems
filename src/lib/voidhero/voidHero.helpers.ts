import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, uv, mx_noise_float, vec3, float, smoothstep } from 'three/tsl';
import { detectMob } from '$lib/utils/isMobile';
import type { SceneEventBus } from './events';

const isMobile = detectMob();

export const MUTE_STORAGE_KEY = 'voidhero:muted';
export const TRACK_STORAGE_KEY = 'voidhero:track';
export const VOLUME_STORAGE_KEY = 'voidhero:volume';
export const BEST_SCORE_STORAGE_KEY = 'voidhero:bestScore';
export const BEST_STAGE_STORAGE_KEY = 'voidhero:bestStage';

export const MAX_LIVES = 3;
export const COMBO_LIFE_REGEN_STEP = 25;

export interface MusicTrack {
	readonly id: string;
	readonly label: string;
	readonly src: string;
	readonly bpm: number;
	// Seconds from file start to the first downbeat we want to spawn against.
	readonly beatOffsetSec: number;
	// 1 = one pattern step per beat. Use 2 for slower tracks / 0.5 for half-time feel.
	readonly beatsPerStep: number;
	readonly credit?: string;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
	{
		id: 'none',
		label: 'No music',
		src: '',
		bpm: 0,
		beatOffsetSec: 0,
		beatsPerStep: 1
	},
	{
		id: 'synthwave',
		label: 'Synthwave 15k',
		src: '/sounds/voidhero/synthwave-15k.mp3',
		bpm: 110,
		beatOffsetSec: 0.51,
		beatsPerStep: 1,
		credit: 'The Cynic Project — CC0'
	},
	{
		id: 'oldskool',
		label: 'Oldskool',
		src: '/sounds/voidhero/oldskool.mp3',
		bpm: 120,
		beatOffsetSec: 0,
		beatsPerStep: 1,
		credit: 'Of Far Different Nature — CC0'
	},
	{
		id: 'space-ranger',
		label: 'Space Ranger',
		src: '/sounds/voidhero/space-ranger.mp3',
		bpm: 80,
		beatOffsetSec: 0,
		beatsPerStep: 1,
		credit: 'CC0'
	}
];

export const DEFAULT_TRACK_ID = 'synthwave';
export const DEFAULT_VOLUME = 0.55;

export const LANE_COUNT = 4;
export const LANE_LABELS: readonly string[] = ['1', '2', '3', '4'];
export const PAD_LABELS: readonly string[] = ['D/1', 'F/2', 'J/3', 'K/4'];
export const KEY_TO_LANE: ReadonlyMap<string, number> = new Map<string, number>([
	['d', 0],
	['1', 0],
	['f', 1],
	['2', 1],
	['j', 2],
	['3', 2],
	['k', 3],
	['4', 3]
]);

export interface RunHudState {
	active: boolean;
	score: number;
	combo: number;
	message: string;
	laneLabels: string[];
	stageName: string;
	stageProgress: number;
	progressionActive: boolean;
	lives: number;
	maxLives: number;
	// One entry per heart slot. 1 = full red, 5 = empty/gray.
	// Animates 1→5 on damage and 5→1 on regen so the HUD can crack/restore hearts in steps.
	heartStages: number[];
	bestScore: number;
	bestStage: string;
}

export interface MusicState {
	muted: boolean;
	tracks: readonly MusicTrack[];
	currentTrackId: string;
	volume: number;
}

export type PopupTier = 'judgment' | 'combo' | 'milestone';

export interface PadLabel {
	label: string;
	x: number;
	y: number;
}

export interface ComboVfxTextures {
	/** Vertical lightning bolt mask (grayscale). */
	bolt: THREE.Texture;
	/** Second bolt frame, cross-faded per strike so repeats don't read identically. */
	boltAlt: THREE.Texture;
	/** Flat impact burst mask, dropped on the lane at milestone strikes. */
	impact: THREE.Texture;
}

export interface VoidHeroConfig {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	floorMeshes: THREE.Mesh[];
	cameraForwardDirection: THREE.Vector3;
	baseCameraPosition: THREE.Vector3;
	events: SceneEventBus;
	onCameraShake?: (intensity: number) => void;
	/** Combo lightning textures, injected by the host scene. Absent → combo VFX off. */
	comboVfx?: ComboVfxTextures;
}

export type NoteSpec = number | { readonly lane: number; readonly hold?: number };

export const PATTERN: NoteSpec[][] = [
	[0],
	[2],
	[1, 3],
	[0],
	[{ lane: 2, hold: 1.4 }],
	[3],
	[1],
	[0, 2],
	[3],
	[{ lane: 1, hold: 0.95 }],
	[2],
	[0, 3],
	[{ lane: 2, hold: 1.7 }, 0],
	[3],
	[0],
	[1, 3]
];

export type GameMaterialHandle = {
	material: MeshStandardNodeMaterial;
	opacity: ReturnType<typeof uniform>;
	intensity: ReturnType<typeof uniform>;
	baseOpacity: number;
	baseIntensity: number;
	tint?: ReturnType<typeof uniform>;
};

export type GameFrame = {
	right: THREE.Vector3;
	up: THREE.Vector3;
	forward: THREE.Vector3;
	orientation: THREE.Quaternion;
	floorY: number;
	nearT: number;
	farT: number;
	hitT: number;
	laneWidth: number;
	laneCenters: number[];
};

export type GameCameraView = {
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	fov: number;
};

export type GameNote = {
	group: THREE.Group;
	lane: number;
	travel: number;
	hold: number;
	holdLengthT: number;
	tailMesh: THREE.Mesh | null;
	trailMesh: THREE.Mesh | null;
	ringMesh: THREE.Mesh | null;
	coreMesh: THREE.Mesh | null;
	headHit: boolean;
};

export type InputSource = `key:${string}` | `pointer:${number}`;

export type HoldState = {
	note: GameNote;
	source: InputSource;
	scoreAccumulator: number;
};

export type GameSpark = {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	life: number;
	maxLife: number;
	baseScale: number;
};

export type FxSlot = {
	index: number;
	alive: boolean;
	life: number;
	maxLife: number;
	startScaleXZ: number;
	endScaleXZ: number;
	scaleY: number;
	startOpacity: number;
	startIntensity: number;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
};

export type FxPool = {
	mesh: THREE.InstancedMesh;
	opacityAttr: THREE.InstancedBufferAttribute;
	intensityAttr: THREE.InstancedBufferAttribute;
	colorAttr: THREE.InstancedBufferAttribute;
	/** Per-slot texture-frame selector (0/1). Present only on textured pools. */
	variantAttr?: THREE.InstancedBufferAttribute;
	slots: FxSlot[];
};

export type SfxName =
	| 'intro'
	| 'hit_perfect'
	| 'hit_nice'
	| 'miss'
	| 'early'
	| 'combo_milestone'
	| 'heart_break';

export function easeOutCubic(value: number): number {
	const clamped = THREE.MathUtils.clamp(value, 0, 1);
	return 1 - Math.pow(1 - clamped, 3);
}

export function computeFrame(config: VoidHeroConfig): GameFrame {
	const up = new THREE.Vector3(0, 1, 0);
	const forward = config.cameraForwardDirection.clone();
	forward.y = 0;
	if (forward.lengthSq() < 0.0001) {
		forward.set(0, 0, -1);
	}
	forward.normalize();

	const right = new THREE.Vector3().crossVectors(forward, up);
	if (right.lengthSq() < 0.0001) {
		right.set(1, 0, 0);
	}
	right.normalize();

	const floorBox = new THREE.Box3();
	for (const mesh of config.floorMeshes) {
		floorBox.expandByObject(mesh);
	}

	if (floorBox.isEmpty()) {
		const fallbackCenter = config.baseCameraPosition.clone().addScaledVector(forward, 28);
		floorBox.setFromCenterAndSize(fallbackCenter, new THREE.Vector3(8, 0.2, 52));
	}

	const min = floorBox.min;
	const max = floorBox.max;
	const corners = [
		new THREE.Vector3(min.x, min.y, min.z),
		new THREE.Vector3(min.x, min.y, max.z),
		new THREE.Vector3(min.x, max.y, min.z),
		new THREE.Vector3(min.x, max.y, max.z),
		new THREE.Vector3(max.x, min.y, min.z),
		new THREE.Vector3(max.x, min.y, max.z),
		new THREE.Vector3(max.x, max.y, min.z),
		new THREE.Vector3(max.x, max.y, max.z)
	];

	let minR = Infinity;
	let maxR = -Infinity;
	let minT = Infinity;
	let maxT = -Infinity;

	for (const corner of corners) {
		const r = corner.dot(right);
		const t = corner.dot(forward);
		minR = Math.min(minR, r);
		maxR = Math.max(maxR, r);
		minT = Math.min(minT, t);
		maxT = Math.max(maxT, t);
	}

	const width = Math.max(3.8, maxR - minR);
	const usableWidth = THREE.MathUtils.clamp(
		width * 0.72,
		isMobile ? 4.4 : 5.8,
		isMobile ? 6.2 : 8.8
	);
	const centerR = (minR + maxR) * 0.5;
	const laneWidth = usableWidth / LANE_COUNT;
	const cameraT = config.baseCameraPosition.dot(forward);
	let nearT = THREE.MathUtils.clamp(cameraT + 4.4, minT + 1.2, maxT - 16);
	let farT = Math.min(maxT - 1.6, nearT + (isMobile ? 28 : 46));

	if (!Number.isFinite(nearT) || !Number.isFinite(farT) || farT - nearT < 14) {
		nearT = minT + 2;
		farT = maxT - 2;
	}

	const hitT = nearT + Math.min(4.8, Math.max(2.6, (farT - nearT) * 0.16));
	const laneCenters = Array.from(
		{ length: LANE_COUNT },
		(_, i) => centerR - usableWidth / 2 + laneWidth * (i + 0.5)
	);
	// Build a proper right-handed rotation that maps local +Z → world `forward`.
	// `frame.right = cross(forward, up)` is left-handed for this purpose, so the
	// basis (right, up, forward) has det = -1 and yields a broken quaternion.
	// Use cross(up, forward) for the orientation's X axis instead — geometries
	// (rings, tail plane) are symmetric across local X so the visual is unaffected.
	const orientationRight = new THREE.Vector3().crossVectors(up, forward);
	const orientation = new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(orientationRight, up, forward)
	);

	return {
		right,
		up,
		forward,
		orientation,
		floorY: floorBox.max.y + 0.045,
		nearT,
		farT,
		hitT,
		laneWidth,
		laneCenters
	};
}

export function toWorld(
	frame: GameFrame,
	r: number,
	t: number,
	yOffset: number,
	target: THREE.Vector3
): THREE.Vector3 {
	return target
		.set(0, 0, 0)
		.addScaledVector(frame.right, r)
		.addScaledVector(frame.forward, t)
		.addScaledVector(frame.up, frame.floorY + yOffset);
}

const quadScratch = new THREE.Vector3();

export function createQuadGeometry(
	frame: GameFrame,
	leftR: number,
	rightR: number,
	startT: number,
	endT: number,
	yOffset: number
): THREE.BufferGeometry {
	const positions = new Float32Array(12);
	let v = toWorld(frame, leftR, startT, yOffset, quadScratch);
	positions[0] = v.x;
	positions[1] = v.y;
	positions[2] = v.z;
	v = toWorld(frame, rightR, startT, yOffset, quadScratch);
	positions[3] = v.x;
	positions[4] = v.y;
	positions[5] = v.z;
	v = toWorld(frame, rightR, endT, yOffset, quadScratch);
	positions[6] = v.x;
	positions[7] = v.y;
	positions[8] = v.z;
	v = toWorld(frame, leftR, endT, yOffset, quadScratch);
	positions[9] = v.x;
	positions[10] = v.y;
	positions[11] = v.z;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex([0, 1, 2, 0, 2, 3]);
	geometry.computeVertexNormals();
	return geometry;
}

export function createOctagonRingGeometry(
	innerRadius: number,
	outerRadius: number
): THREE.ShapeGeometry {
	const shape = buildOctagonRingShape(innerRadius, outerRadius);
	return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

export function createOctagonPrismGeometry(
	innerRadius: number,
	outerRadius: number,
	depth: number
): THREE.ExtrudeGeometry {
	const shape = buildOctagonRingShape(innerRadius, outerRadius);
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth,
		bevelEnabled: false,
		curveSegments: 1,
		steps: 1
	});
	// Extrude lies in XY (caps at Z=0 and Z=depth). Rotate so caps face up/down,
	// bottom cap at world Y=0 and top cap at Y=depth — matches the flat helper's plane.
	return geometry.rotateX(-Math.PI / 2);
}

function buildOctagonRingShape(innerRadius: number, outerRadius: number): THREE.Shape {
	const shape = new THREE.Shape();
	const hole = new THREE.Path();
	const sides = 8;
	const angleOffset = Math.PI / sides;

	for (let i = 0; i <= sides; i++) {
		const angle = angleOffset + (i / sides) * Math.PI * 2;
		const x = Math.cos(angle) * outerRadius;
		const y = Math.sin(angle) * outerRadius;
		if (i === 0) shape.moveTo(x, y);
		else shape.lineTo(x, y);
	}

	for (let i = sides; i >= 0; i--) {
		const angle = angleOffset + (i / sides) * Math.PI * 2;
		const x = Math.cos(angle) * innerRadius;
		const y = Math.sin(angle) * innerRadius;
		if (i === sides) hole.moveTo(x, y);
		else hole.lineTo(x, y);
	}

	shape.holes.push(hole);
	return shape;
}

export function createGlowMaterial(
	hex: string,
	baseOpacity: number,
	baseIntensity: number
): GameMaterialHandle {
	const opacity = uniform(0);
	const intensity = uniform(baseIntensity);
	const materialColor = uniform(new THREE.Color(hex));
	const material = new MeshStandardNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		roughness: 0.22,
		metalness: 0.05
	});

	material.colorNode = materialColor.mul(0.85);
	material.emissiveNode = materialColor.mul(intensity as any).mul(opacity as any);
	material.opacityNode = opacity;

	return {
		material,
		opacity,
		intensity,
		baseOpacity,
		baseIntensity
	};
}

export function createPadGlowMaterial(
	hex: string,
	baseOpacity: number,
	baseIntensity: number
): GameMaterialHandle {
	const opacity = uniform(0);
	const intensity = uniform(baseIntensity);
	const materialColor = uniform(new THREE.Color(hex));
	const tint = uniform(new THREE.Color(0xffffff));
	const material = new MeshStandardNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		roughness: 0.22,
		metalness: 0.05
	});

	material.colorNode = materialColor.mul(0.85);
	material.emissiveNode = materialColor
		.mul(tint as any)
		.mul(intensity as any)
		.mul(opacity as any);
	material.opacityNode = opacity;

	return {
		material,
		opacity,
		intensity,
		baseOpacity,
		baseIntensity,
		tint
	};
}

export function createNoteTrailMaterial(): MeshStandardNodeMaterial {
	return createSustainMaterial(0.85, 0.32);
}

export function createMonoMaterial(intensityValue: number): MeshStandardNodeMaterial {
	const colorUniform = uniform(new THREE.Color(0xffffff));
	const intensityUniform = uniform(intensityValue);
	const material = new MeshStandardNodeMaterial({
		transparent: false,
		depthWrite: true,
		side: THREE.FrontSide,
		roughness: 0.18,
		metalness: 0.08
	});
	material.colorNode = colorUniform.mul(0.96);
	material.emissiveNode = colorUniform.mul(intensityUniform as any);
	return material;
}

export function createSustainMaterial(
	intensityValue: number,
	opacityValue: number
): MeshStandardNodeMaterial {
	const colorUniform = uniform(new THREE.Color(0xffffff));
	const intensityUniform = uniform(intensityValue);
	const opacityUniform = uniform(opacityValue);
	const sustainUv = uv();
	const sideCenter = float(1).sub(sustainUv.x.sub(0.5).abs().mul(2)).clamp(0, 1);
	const sideFade = sideCenter.pow(0.55);
	// Plane UV.y is 1 at the head/near edge and 0 at the far tail after geometry rotation.
	const tailFade = smoothstep(float(0.02), float(0.36), sustainUv.y);
	const alpha = opacityUniform.mul(sideFade).mul(tailFade);
	const material = new MeshStandardNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending,
		roughness: 0.4,
		metalness: 0
	});
	material.colorNode = vec3(0, 0, 0);
	material.emissiveNode = colorUniform.mul(intensityUniform as any).mul(alpha as any);
	material.opacityNode = alpha;
	return material;
}

export function createRimFlameMaterial(
	rimFlameTime: ReturnType<typeof uniform>
): MeshStandardNodeMaterial {
	const material = new MeshStandardNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending,
		roughness: 1,
		metalness: 0
	});
	const u = uv();
	// 1 at base, 0 at top — flame fades upward
	const verticalFade = float(1).sub(u.y).clamp(0, 1).pow(1.5);
	// Soft horizontal mask so edges aren't visible seams
	const hCenter = u.x.sub(0.5).abs().mul(2);
	const horizontalFade = float(1).sub(hCenter).clamp(0, 1).pow(1.4);
	// Animated upward-scrolling noise gives the flicker
	const noiseUv = vec3(u.x.mul(2.4), u.y.mul(2.8).sub((rimFlameTime as any).mul(0.55)), 0);
	const n = mx_noise_float(noiseUv).mul(0.5).add(0.5);
	const alpha = verticalFade.mul(horizontalFade).mul(n.pow(0.7));
	material.colorNode = vec3(0, 0, 0);
	material.emissiveNode = vec3(1, 1, 1).mul(alpha).mul(2.4);
	material.opacityNode = alpha.mul(0.85);
	return material;
}
