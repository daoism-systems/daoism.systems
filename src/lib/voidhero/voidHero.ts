import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, texture, uniform, vec3 } from 'three/tsl';
import { detectMob } from '$lib/utils/isMobile';
import {
	BEST_SCORE_STORAGE_KEY,
	BEST_STAGE_STORAGE_KEY,
	COMBO_LIFE_REGEN_STEP,
	DEFAULT_TRACK_ID,
	DEFAULT_VOLUME,
	KEY_TO_LANE,
	LANE_COUNT,
	LANE_LABELS,
	MAX_LIVES,
	MUSIC_TRACKS,
	MUTE_STORAGE_KEY,
	PAD_LABELS,
	PATTERN,
	TRACK_STORAGE_KEY,
	VOLUME_STORAGE_KEY,
	computeFrame,
	createGlowMaterial,
	createMonoMaterial,
	createNoteTrailMaterial,
	createOctagonPrismGeometry,
	createOctagonRingGeometry,
	createPadGlowMaterial,
	createQuadGeometry,
	createRimFlameMaterial,
	createSustainMaterial,
	easeOutCubic,
	toWorld,
	type FxPool,
	type FxSlot,
	type GameCameraView,
	type GameFrame,
	type GameMaterialHandle,
	type GameNote,
	type GameSpark,
	type HoldState,
	type InputSource,
	type MusicTrack,
	type PadLabel,
	type PopupTier,
	type SfxName,
	type VoidHeroConfig
} from './voidHero.helpers';
import {
	HISTORY_SIZE,
	getActiveAxes,
	getStageForStep,
	pickNextPattern,
	type ActiveAxes,
	type PatternEntry
} from './voidHero.progression';
import { chartSalienceGate, getChartForTrack, type TrackChart } from './voidHero.charts';

export type {
	RunHudState,
	MusicState,
	PadLabel,
	PopupTier,
	GameCameraView,
	VoidHeroConfig
} from './voidHero.helpers';

const isMobile = detectMob();

export class VoidHeroGame {
	private root = new THREE.Group();
	private warmupGroup: THREE.Group | null = null;
	private frame: GameFrame;
	// Notes: a flat octagonal frame + a thin octagonal core, both monochrome.
	private noteRingGeometry = createOctagonRingGeometry(0.34, 0.54);
	private noteCoreGeometry = new THREE.CircleGeometry(0.31, 8).rotateX(-Math.PI / 2);
	private readonly padPrismDepth = 0.22;
	private padRingGeometry = createOctagonPrismGeometry(0.4, 0.5, this.padPrismDepth);
	private padCoreGeometry = new THREE.CircleGeometry(0.36, 8).rotateX(-Math.PI / 2);
	// Hold tail: unit Plane laid flat on the lane (local +Z = world forward, +X = lane width, +Y = up).
	// Pre-translate so z spans [0, 1]; mesh.position is its near edge, scale.z is its visible length.
	private holdTailGeometry = new THREE.PlaneGeometry(1, 1)
		.rotateX(-Math.PI / 2)
		.translate(0, 0, 0.5);
	private sparkGeometry = new THREE.TetrahedronGeometry(1, 0);
	// FX geometries (flat shockwave + vertical light beam) for hit/miss bursts.
	private fxRingGeometry = new THREE.RingGeometry(0.42, 0.5, isMobile ? 24 : 40).rotateX(
		-Math.PI / 2
	);
	private fxBeamGeometry = new THREE.CylinderGeometry(0.18, 0.05, 1, isMobile ? 8 : 14, 1);
	private rimFlameGeometry = new THREE.PlaneGeometry(1, 1);
	// Combo lightning VFX. Bolt: upright unit plane pre-translated so local +Y spans [0,1]
	// (base at the mesh origin → rises along frame.up). Impact: flat plane like the FX ring.
	private comboBoltGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
	private comboImpactGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

	private noteRingMaterial: MeshStandardNodeMaterial;
	private noteCoreMaterial: MeshStandardNodeMaterial;
	private sparkMaterial: MeshStandardNodeMaterial;
	private holdTailMaterial: MeshStandardNodeMaterial;
	private noteTrailMaterial: MeshStandardNodeMaterial;

	private notes: GameNote[] = [];
	private sparks: GameSpark[] = [];
	private laneHandles: GameMaterialHandle[] = [];
	private separatorHandles: GameMaterialHandle[] = [];
	private padHandles: GameMaterialHandle[] = [];
	private padCoreHandles: GameMaterialHandle[] = [];
	private padMeshes: THREE.Mesh[] = [];
	private padCoreMeshes: THREE.Mesh[] = [];
	private rimFlameMeshes: THREE.Mesh[] = [];
	private padWorldPositions: THREE.Vector3[] = [];
	private padProjScratch = new THREE.Vector3();
	private padScreenX = new Array(LANE_COUNT).fill(0);
	private padScreenY = new Array(LANE_COUNT).fill(0);
	private popupProjScratch = new THREE.Vector3();
	private padRotScratch = new THREE.Quaternion();
	private padAxisScratch = new THREE.Vector3(0, 1, 0);
	private cameraLookTarget = new THREE.Vector3();
	private cameraFitScratch = new THREE.Vector3();
	private cameraInverseQuaternion = new THREE.Quaternion();
	private cameraLookMatrix = new THREE.Matrix4();
	private cameraFitPoints = Array.from({ length: 10 }, () => new THREE.Vector3());
	private padPulses = new Array(LANE_COUNT).fill(0);
	private padApproach = new Array(LANE_COUNT).fill(0);
	private padMissFlash = new Array(LANE_COUNT).fill(0);
	private padRotation = new Array(LANE_COUNT).fill(0);
	private padCoreFill = new Array(LANE_COUNT).fill(0);
	private padCorePulse = new Array(LANE_COUNT).fill(0);
	// Smoothed press "force" in [0,1] — ramps up while a lane key/pointer is held, decays on release.
	// Independent of holding[] (which is note-locked) so the pad charges on every press, note or not.
	private padForce = new Array(LANE_COUNT).fill(0);
	private laneHoldRefcount = new Array(LANE_COUNT).fill(0);
	// Latched on a missing press (no note matched in window); cleared when the key is fully released
	// or a successful press lands. Drives the sustained-red while-held tint, gated by padForce.
	private padNoNote = new Array(LANE_COUNT).fill(false);
	private lanePulses = new Array(LANE_COUNT).fill(0);
	private readonly hitColorWhite = new THREE.Color(0xffffff);
	private readonly hitColorGold = new THREE.Color(0xffd040);
	private readonly hitColorHot = new THREE.Color(0xeaffff);
	private holding: (HoldState | null)[] = new Array(LANE_COUNT).fill(null);
	private pointerLaneById = new Map<number, number>();
	private readonly holdScoreInterval = 0.16;
	private readonly holdCompletionBonus = 5;
	private readonly holdReleaseLeadTime = 0.1;

	// FX pools — one InstancedMesh per pool, per-slot state lives in instanced buffer attributes
	// (fxOpacity / fxIntensity / fxColor) so 14 transient FX bursts share two pipelines.
	private hitRingPool!: FxPool;
	private hitBeamPool!: FxPool;
	// Textured combo pools — built only when the host injects the lightning textures.
	private comboBoltPool: FxPool | null = null;
	private comboImpactPool: FxPool | null = null;
	// Lightning fires on every perfect hit once the combo is rolling; the milestone
	// thresholds the popups already celebrate get a bigger, tier-colored strike + impact.
	private readonly comboArcThreshold = 6;
	private readonly comboArcColor = new THREE.Color(0x9fdcff);
	private fxMatrixScratch = new THREE.Matrix4();
	private fxScaleScratch = new THREE.Vector3();
	private fxHiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
	private rimFlameTime = uniform(0);

	private spawnTimer = 1.2;
	private patternIndex = 0;
	private elapsed = 0;
	private introProgress = 0;
	private playing = false;
	// Visuals-only mode: pads/scoreboard render at 0, but spawning, music, input,
	// and scoring stay paused until `start()` promotes preview → playing.
	private previewing = false;
	private gameOver = false;
	private listenersAttached = false;
	private score = 0;
	private combo = 0;
	private lives = MAX_LIVES;
	private lastComboLifeMilestone = 0;
	// Smoothed float stage per heart slot in [1, 5]. 1 = full red, 5 = empty/gray.
	// Lerped each frame toward `lives`-derived target — animates the heart-bar crack/restore.
	private heartStage = new Array(MAX_LIVES).fill(1);
	// Last rounded value published in runHud, so we only re-emit when the displayed sprite changes.
	private heartStageDisplay = new Array(MAX_LIVES).fill(1);
	// Stage units per second: 4 units (1→5) in ~333ms reads as a satisfying crack without lagging the miss.
	private readonly heartStageSpeed = 12;
	private bestScore = 0;
	private bestStageSteps = 0;
	private hudMessage = isMobile ? 'Tap the glowing lane' : 'Press D F J K';
	private readonly baseNoteSpeed: number;
	private readonly baseHitWindow = 1.58;
	private readonly minHitWindow = 1.08;
	private readonly baseBeatInterval = 0.78;
	private readonly minBeatInterval = 0.48;

	// Progression state — only ticks while music is locked. The free-running fallback
	// keeps the legacy PATTERN loop and pins axes to Stage 0.
	private totalSteps = 0;
	private currentPattern: PatternEntry | null = null;
	private patternStepCursor = 0;
	private patternHistory: string[] = [];
	private lastBurstStep = -10_000;
	private currentStageName = '';
	private currentAxes: ActiveAxes = getActiveAxes(0);
	// Time (in track-time seconds) at which the next pattern step's note should
	// arrive at the hit line. null until first music sync — see updateMusicSpawn.
	private nextSpawnTime: number | null = null;

	// Music-derived chart playback. When the current track has a generated
	// chart, notes spawn from it (gated by stage densityBias via salience) and
	// the beat clock above only paces stage progression. Null → pattern bank.
	private currentChart: TrackChart | null = null;
	private chartCursor = 0;
	// The audio loops, so both clocks live on a virtual timeline of whole
	// passes. The two counters are distinct: the cursor wraps the note list
	// ~travel-time BEFORE the audio wraps (notes spawn ahead of arrival).
	private chartAudioPass = 0;
	private chartNotePass = 0;
	private chartLastArrival: number | null = null;

	private audioCtx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private muted = false;
	// Sampled heart-break SFX (CC0 — 80-creature-SFX pack, hurt_04.ogg).
	// Decoded once on first AudioContext init; falls back to a synth blip if fetch/decode fails.
	private heartBreakBuffer: AudioBuffer | null = null;
	private heartBreakLoading = false;

	// Music layer (HTMLAudioElement streamed through Web Audio for analyser + gain).
	private musicAudio: HTMLAudioElement | null = null;
	private musicSourceNode: MediaElementAudioSourceNode | null = null;
	private musicGain: GainNode | null = null;
	private musicAnalyser: AnalyserNode | null = null;
	private musicFreqData: Uint8Array | null = null;
	private currentTrack: MusicTrack;
	private musicVolume: number;
	// Smoothed low-frequency energy in [0, 1] from the live AnalyserNode — drives visual pulse.
	private bassEnergy = 0;

	constructor(private readonly config: VoidHeroConfig) {
		this.root.name = 'VoidHeroGame';
		this.frame = computeFrame(this.config);
		this.baseNoteSpeed = Math.max(6.35, (this.frame.farT - this.frame.hitT) / 4.2);
		this.root.visible = false;
		this.muted = this.readMutePreference();
		this.currentTrack = this.resolveTrack(this.readStoredTrackId());
		this.currentChart = getChartForTrack(this.currentTrack.id);
		this.musicVolume = this.readStoredVolume();
		this.bestScore = this.readStoredBestScore();
		this.bestStageSteps = this.readStoredBestStageSteps();
		this.noteRingMaterial = createMonoMaterial(2.6);
		this.noteCoreMaterial = createMonoMaterial(0.3);
		this.sparkMaterial = createMonoMaterial(2.2);
		this.holdTailMaterial = createSustainMaterial(1.45, 0.42);
		this.noteTrailMaterial = createNoteTrailMaterial();
		this.buildLanes();
		this.buildFxPools();
		this.buildRimFlames();
		this.config.scene.add(this.root);
		// Seed both event streams once at construction so the Svelte side can render
		// the mixer (track/volume) and the run HUD before/after the game runs.
		this.publishRunHud();
		this.publishMusicState();
	}

	get transitionAmount(): number {
		return easeOutCubic(this.introProgress);
	}

	get active(): boolean {
		return this.playing;
	}

	/** True whenever `root` is live on screen — a run OR the mobile preview. */
	get running(): boolean {
		return this.playing || this.previewing;
	}

	getCameraView(aspect: number, out: GameCameraView): GameCameraView {
		const trackSpan = Math.max(1, this.frame.farT - this.frame.hitT);
		const targetT = this.frame.hitT + trackSpan * (isMobile ? 0.48 : 0.52);
		const backDistance = THREE.MathUtils.clamp(
			trackSpan * (isMobile ? 0.2 : 0.18),
			isMobile ? 7.2 : 6.8,
			isMobile ? 11 : 10
		);
		const lift = THREE.MathUtils.clamp(
			trackSpan * (isMobile ? 0.18 : 0.13),
			isMobile ? 4.2 : 3.4,
			isMobile ? 6.2 : 5.6
		);

		toWorld(this.frame, 0, this.frame.hitT - backDistance, lift, out.position);
		toWorld(this.frame, 0, targetT, isMobile ? 0.45 : 0.32, this.cameraLookTarget);
		this.cameraLookMatrix.lookAt(out.position, this.cameraLookTarget, this.frame.up);
		out.quaternion.setFromRotationMatrix(this.cameraLookMatrix);
		out.fov = this.getFittedCameraFov(out.position, out.quaternion, Math.max(0.3, aspect));
		return out;
	}

	private getFittedCameraFov(
		position: THREE.Vector3,
		quaternion: THREE.Quaternion,
		aspect: number
	): number {
		const laneLeft = this.frame.laneCenters[0] - this.frame.laneWidth * 0.66;
		const laneRight =
			this.frame.laneCenters[this.frame.laneCenters.length - 1] + this.frame.laneWidth * 0.66;
		const nearT = this.frame.hitT - this.frame.laneWidth * 0.62;
		const farT = this.frame.farT + this.frame.laneWidth * 0.2;
		const lowY = 0.02;
		const highY = isMobile ? 0.92 : 0.78;
		const fitPoints = this.cameraFitPoints;

		toWorld(this.frame, laneLeft, nearT, lowY, fitPoints[0]);
		toWorld(this.frame, laneRight, nearT, lowY, fitPoints[1]);
		toWorld(this.frame, laneLeft, farT, lowY, fitPoints[2]);
		toWorld(this.frame, laneRight, farT, lowY, fitPoints[3]);
		toWorld(this.frame, laneLeft, nearT, highY, fitPoints[4]);
		toWorld(this.frame, laneRight, nearT, highY, fitPoints[5]);
		toWorld(this.frame, laneLeft, farT, highY, fitPoints[6]);
		toWorld(this.frame, laneRight, farT, highY, fitPoints[7]);
		toWorld(this.frame, 0, nearT, highY, fitPoints[8]);
		toWorld(this.frame, 0, farT, highY, fitPoints[9]);

		this.cameraInverseQuaternion.copy(quaternion).invert();
		const safeX = isMobile ? 0.86 : 0.8;
		const safeY = isMobile ? 0.78 : 0.72;
		let requiredTan = 0;

		for (const point of fitPoints) {
			this.cameraFitScratch.copy(point).sub(position).applyQuaternion(this.cameraInverseQuaternion);
			const depth = -this.cameraFitScratch.z;
			if (depth <= 0.001) continue;
			requiredTan = Math.max(
				requiredTan,
				Math.abs(this.cameraFitScratch.x) / (depth * aspect * safeX),
				Math.abs(this.cameraFitScratch.y) / (depth * safeY)
			);
		}

		const fittedFov = THREE.MathUtils.radToDeg(Math.atan(requiredTan) * 2);
		const cinematicFov = isMobile ? 54 : 44;
		const maxFov = isMobile ? 72 : 62;
		return THREE.MathUtils.clamp(Math.max(cinematicFov, fittedFov), cinematicFov, maxFov);
	}

	/**
	 * Adds one hidden instance of every gameplay-only material/geometry variant
	 * so the 404 scene warmup can compile them before the first secret-game start.
	 */
	prewarmForCompile(): void {
		if (this.warmupGroup) return;

		const group = new THREE.Group();
		group.name = 'VoidHeroWarmup';
		group.visible = false;

		const laneCenter = this.frame.laneCenters[0] ?? 0;
		const basePosition = toWorld(
			this.frame,
			laneCenter,
			this.frame.hitT + 1,
			0.08,
			new THREE.Vector3()
		);

		const noteGroup = new THREE.Group();
		noteGroup.position.copy(basePosition);
		noteGroup.quaternion.copy(this.frame.orientation);
		noteGroup.scale.setScalar(this.frame.laneWidth * 0.42);
		noteGroup.add(new THREE.Mesh(this.noteRingGeometry, this.noteRingMaterial));
		noteGroup.add(new THREE.Mesh(this.noteCoreGeometry, this.noteCoreMaterial));
		group.add(noteGroup);

		const holdTail = new THREE.Mesh(this.holdTailGeometry, this.holdTailMaterial);
		holdTail.position
			.copy(basePosition)
			.addScaledVector(this.frame.right, this.frame.laneWidth * 0.4);
		holdTail.quaternion.copy(this.frame.orientation);
		holdTail.scale.set(this.frame.laneWidth * 0.28, 1, 1);
		group.add(holdTail);

		const noteTrail = new THREE.Mesh(this.holdTailGeometry, this.noteTrailMaterial);
		noteTrail.position
			.copy(basePosition)
			.addScaledVector(this.frame.right, -this.frame.laneWidth * 0.4);
		noteTrail.quaternion.copy(this.frame.orientation);
		noteTrail.scale.set(this.frame.laneWidth * 0.22, 1, 0.7);
		group.add(noteTrail);

		const spark = new THREE.Mesh(this.sparkGeometry, this.sparkMaterial);
		spark.position.copy(basePosition).addScaledVector(this.frame.up, 0.5);
		spark.quaternion.copy(this.frame.orientation);
		spark.scale.setScalar(0.06);
		group.add(spark);

		this.root.add(group);
		this.warmupGroup = group;
	}

	/**
	 * Toggle game-scene visibility for the 404 warmup render loop. Visible=true forces
	 * `root` plus the FX pool meshes (which are otherwise hidden until first burst) into
	 * the real post-processing graph so first-use pipeline costs are paid during loading.
	 * Seeds one instance per pool with sub-pixel opacity so the InstancedMesh draw actually
	 * runs through the bloom/CA/fluid passes during warmup.
	 */
	/**
	 * Expose every hidden game mesh (root, warmup group, FX pools) to a
	 * compileAsync render-list capture. Both the expose and restore call MUST
	 * happen within one synchronous block — no frame may present in between
	 * (see NotFoundRenderer.precompileExposedAsync).
	 */
	setCompileVisible(visible: boolean): void {
		this.root.visible = visible;
		if (this.warmupGroup) this.warmupGroup.visible = visible;
		for (const pool of [
			this.hitRingPool,
			this.hitBeamPool,
			this.comboBoltPool,
			this.comboImpactPool
		]) {
			if (pool) pool.mesh.visible = visible;
		}
	}

	setPrewarmVisible(visible: boolean): void {
		// Never hide a live run: the deferred post-reveal prewarm may race a real
		// start(), and un-showing root / zeroing pool slot 0 would kill live FX.
		if (!visible && this.running) return;
		this.root.visible = visible;
		// Rim flames have no opacity gate (pure noise alpha, additive) — they would
		// visibly flash during on-screen prewarm frames. Their pipelines still
		// compile via the setCompileVisible capture.
		for (const mesh of this.rimFlameMeshes) mesh.visible = !visible;
		const pools = [this.hitRingPool, this.hitBeamPool, this.comboBoltPool, this.comboImpactPool];
		for (const pool of pools) {
			if (!pool) continue;
			pool.mesh.visible = visible;
			if (visible) {
				pool.opacityAttr.array[0] = 0.001;
				pool.intensityAttr.array[0] = 1;
				pool.colorAttr.array[0] = 1;
				pool.colorAttr.array[1] = 1;
				pool.colorAttr.array[2] = 1;
				pool.opacityAttr.needsUpdate = true;
				pool.intensityAttr.needsUpdate = true;
				pool.colorAttr.needsUpdate = true;
				const anchor = this.padWorldPositions[0] ?? this.cameraLookTarget;
				const m = this.fxMatrixScratch.compose(
					anchor,
					this.frame.orientation,
					this.fxScaleScratch.set(0.01, 0.01, 0.01)
				);
				pool.mesh.setMatrixAt(0, m);
			} else {
				pool.opacityAttr.array[0] = 0;
				pool.opacityAttr.needsUpdate = true;
				pool.mesh.setMatrixAt(0, this.fxHiddenMatrix);
			}
			pool.mesh.instanceMatrix.needsUpdate = true;
		}
	}

	/**
	 * Render pads/scoreboard at 0 without running the game. Used by the mobile
	 * 'ready' state so the player sees the play surface behind a START GAME button
	 * before any notes spawn, music plays, or input is accepted.
	 */
	preview(): void {
		if (this.playing || this.previewing) return;
		this.previewing = true;
		this.resetRunState();
		this.publishRunHud(this.hudMessage);
	}

	start(): void {
		if (this.playing) return;
		const fromPreview = this.previewing;
		this.previewing = false;
		this.playing = true;
		if (!fromPreview) this.resetRunState();
		this.spawnTimer = 1.0;
		this.nextSpawnTime = null;
		this.ensureAudio();
		this.playSfx('intro');
		// Defer music decode/play off the first rendered game frame — `createMediaElementSource`
		// + `audio.play()` spike the main thread and would land on the same frame as `root.visible = true`.
		requestAnimationFrame(() => {
			if (this.playing) this.startMusic();
		});
		this.addInputListeners();
		this.publishRunHud(this.hudMessage);
	}

	private resetRunState(): void {
		this.gameOver = false;
		this.root.visible = true;
		// A run may begin mid-prewarm, where the guarded setPrewarmVisible(false)
		// never runs — make sure the flames are back for the live run.
		for (const mesh of this.rimFlameMeshes) mesh.visible = true;
		this.elapsed = 0;
		this.introProgress = 0;
		this.score = 0;
		this.combo = 0;
		this.lives = MAX_LIVES;
		this.hudMessage = isMobile ? 'Tap the glowing lane' : 'Press D F J K';
		this.lastComboLifeMilestone = 0;
		this.totalSteps = 0;
		this.currentPattern = null;
		this.patternStepCursor = 0;
		this.patternHistory = [];
		this.lastBurstStep = -10_000;
		this.currentStageName = '';
		this.currentAxes = getActiveAxes(0);
		this.heartStage.fill(1);
		this.heartStageDisplay.fill(1);
	}

	update(delta: number): void {
		if (!this.playing && !this.previewing) return;
		const frameDelta = THREE.MathUtils.clamp(delta, 0, 0.05);

		this.elapsed += frameDelta;
		this.introProgress = Math.min(1, this.introProgress + frameDelta / 1.15);
		this.rimFlameTime.value = this.elapsed;
		this.sampleBassEnergy(frameDelta);
		this.updateReveal(frameDelta);

		// Spawning, hit detection, and scoring belong to the active run — preview
		// renders the surface only.
		if (this.playing && this.introProgress >= 1) {
			if (this.isMusicSpawning()) {
				this.updateMusicSpawn();
			} else {
				this.spawnTimer -= frameDelta;
				while (this.spawnTimer <= 0) {
					this.spawnPattern();
					this.spawnTimer += this.getBeatInterval();
				}
			}
		}

		this.updateNotes(frameDelta);
		this.updatePads(frameDelta);
		this.updateSparks(frameDelta);
		this.updateFxPool(this.hitRingPool, frameDelta);
		this.updateFxPool(this.hitBeamPool, frameDelta);
		if (this.comboBoltPool) this.updateFxPool(this.comboBoltPool, frameDelta);
		if (this.comboImpactPool) this.updateFxPool(this.comboImpactPool, frameDelta);
		if (this.tickHeartStages(frameDelta)) this.publishRunHud();
		this.publishPadLabels();
	}

	private tickHeartStages(delta: number): boolean {
		const step = this.heartStageSpeed * delta;
		let displayChanged = false;
		for (let i = 0; i < MAX_LIVES; i++) {
			const target = i < this.lives ? 1 : 5;
			const current = this.heartStage[i];
			if (current === target) continue;
			const dir = target > current ? 1 : -1;
			const next = Math.abs(target - current) <= step ? target : current + dir * step;
			this.heartStage[i] = next;
			const rounded = Math.round(next);
			if (rounded !== this.heartStageDisplay[i]) {
				this.heartStageDisplay[i] = rounded;
				displayChanged = true;
			}
		}
		return displayChanged;
	}

	private publishPadLabels(): void {
		// Mobile plays by tapping the lanes directly, so the per-pad labels are hidden
		// there. Input is unaffected — lane detection projects pad positions independently.
		if (isMobile) return;
		this.projectPadScreens();
		const labels: PadLabel[] = [];
		for (let i = 0; i < this.padWorldPositions.length; i++) {
			labels.push({
				label: PAD_LABELS[i] ?? String(i + 1),
				x: this.padScreenX[i],
				y: this.padScreenY[i]
			});
		}
		this.config.events.emit({ kind: 'padLabels', labels });
	}

	private projectPadScreens(): void {
		const camera = this.config.camera;
		const halfW = window.innerWidth * 0.5;
		const halfH = window.innerHeight * 0.5;
		for (let i = 0; i < this.padWorldPositions.length; i++) {
			this.padProjScratch.copy(this.padWorldPositions[i]).project(camera);
			this.padScreenX[i] = (this.padProjScratch.x + 1) * halfW;
			this.padScreenY[i] = (1 - this.padProjScratch.y) * halfH;
		}
	}

	dispose(): void {
		this.stop();
		this.disposeSceneResources();
		this.root.clear();
		this.config.scene.remove(this.root);

		if (this.audioCtx) {
			void this.audioCtx.close();
			this.audioCtx = null;
			this.masterGain = null;
		}
	}

	stop(): void {
		this.playing = false;
		this.previewing = false;
		this.gameOver = false;
		this.elapsed = 0;
		this.introProgress = 0;
		this.bassEnergy = 0;
		this.removeInputListeners();
		this.stopMusic();
		this.clearRunObjects();
		this.holding.fill(null);
		this.pointerLaneById.clear();
		this.padPulses.fill(0);
		this.padApproach.fill(0);
		this.padMissFlash.fill(0);
		this.padRotation.fill(0);
		this.padCoreFill.fill(0);
		this.padCorePulse.fill(0);
		this.padForce.fill(0);
		this.laneHoldRefcount.fill(0);
		this.padNoNote.fill(false);
		this.lanePulses.fill(0);
		this.heartStage.fill(1);
		this.heartStageDisplay.fill(1);
		this.root.visible = false;
		this.publishRunHud();
	}

	private addInputListeners(): void {
		if (this.listenersAttached) return;
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('pointerdown', this.onPointerDown);
		window.addEventListener('pointerup', this.onPointerRelease);
		window.addEventListener('pointercancel', this.onPointerRelease);
		window.addEventListener('blur', this.onWindowBlur);
		// Native context menu can swallow the matching keyup/pointerup, leaving padForce stuck
		// at 1. Treat it the same as a blur — drain all lane state so visuals can decay.
		window.addEventListener('contextmenu', this.onWindowBlur);
		this.listenersAttached = true;
	}

	private removeInputListeners(): void {
		if (!this.listenersAttached) return;
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('pointerdown', this.onPointerDown);
		window.removeEventListener('pointerup', this.onPointerRelease);
		window.removeEventListener('pointercancel', this.onPointerRelease);
		window.removeEventListener('blur', this.onWindowBlur);
		window.removeEventListener('contextmenu', this.onWindowBlur);
		this.listenersAttached = false;
	}

	private clearRunObjects(): void {
		for (const note of this.notes) {
			this.root.remove(note.group);
			if (note.tailMesh) this.root.remove(note.tailMesh);
			if (note.trailMesh) this.root.remove(note.trailMesh);
		}
		this.notes = [];

		for (const spark of this.sparks) {
			this.root.remove(spark.mesh);
		}
		this.sparks = [];

		for (const pool of [
			this.hitRingPool,
			this.hitBeamPool,
			this.comboBoltPool,
			this.comboImpactPool
		]) {
			if (!pool) continue;
			for (const slot of pool.slots) {
				slot.alive = false;
				slot.life = 0;
				pool.opacityAttr.array[slot.index] = 0;
				pool.mesh.setMatrixAt(slot.index, this.fxHiddenMatrix);
			}
			pool.opacityAttr.needsUpdate = true;
			pool.mesh.instanceMatrix.needsUpdate = true;
			pool.mesh.visible = false;
		}
	}

	private disposeSceneResources(): void {
		const geometries = new Set<THREE.BufferGeometry>();
		const materials = new Set<THREE.Material>();

		const collectMaterial = (material: THREE.Material | THREE.Material[]): void => {
			if (Array.isArray(material)) {
				for (const mat of material) materials.add(mat);
				return;
			}
			materials.add(material);
		};

		this.root.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			geometries.add(child.geometry);
			collectMaterial(child.material);
		});

		for (const geometry of [
			this.noteRingGeometry,
			this.noteCoreGeometry,
			this.padRingGeometry,
			this.padCoreGeometry,
			this.holdTailGeometry,
			this.sparkGeometry,
			this.fxRingGeometry,
			this.fxBeamGeometry,
			this.rimFlameGeometry,
			this.comboBoltGeometry,
			this.comboImpactGeometry
		]) {
			geometries.add(geometry);
		}

		for (const material of [
			this.noteRingMaterial,
			this.noteCoreMaterial,
			this.sparkMaterial,
			this.holdTailMaterial,
			this.noteTrailMaterial
		]) {
			materials.add(material);
		}

		geometries.forEach((geometry) => geometry.dispose());
		materials.forEach((material) => material.dispose());
	}

	private buildLanes(): void {
		const laneLengthInset = Math.min(0.18, this.frame.laneWidth * 0.12);
		const separatorWidth = Math.max(0.018, this.frame.laneWidth * 0.025);
		const firstLaneLeft = this.frame.laneCenters[0] - this.frame.laneWidth * 0.5;
		const lastLaneRight =
			this.frame.laneCenters[this.frame.laneCenters.length - 1] + this.frame.laneWidth * 0.5;

		for (let i = 0; i < LANE_COUNT; i++) {
			const laneCenter = this.frame.laneCenters[i];
			const handle = createGlowMaterial('#ffffff', 0.05, 0.18);
			const laneMesh = new THREE.Mesh(
				createQuadGeometry(
					this.frame,
					laneCenter - this.frame.laneWidth * 0.46,
					laneCenter + this.frame.laneWidth * 0.46,
					this.frame.nearT + laneLengthInset,
					this.frame.farT,
					0
				),
				handle.material
			);
			laneMesh.name = `VoidHeroLane_${i + 1}`;
			laneMesh.receiveShadow = false;
			laneMesh.castShadow = false;
			this.root.add(laneMesh);
			this.laneHandles.push(handle);

			const padHandle = createPadGlowMaterial('#ffffff', 0.16, 0.6);
			const pad = new THREE.Mesh(this.padRingGeometry, padHandle.material);
			pad.name = `VoidHeroHitPad_${i + 1}`;
			toWorld(this.frame, laneCenter, this.frame.hitT, 0.025, pad.position);
			pad.quaternion.copy(this.frame.orientation);
			const padScale = this.frame.laneWidth * 0.46;
			pad.scale.set(padScale, padScale, padScale);
			pad.castShadow = false;
			pad.receiveShadow = false;
			this.root.add(pad);
			this.padHandles.push(padHandle);
			this.padMeshes.push(pad);
			this.padWorldPositions.push(pad.position.clone());

			const coreHandle = createGlowMaterial('#ffffff', 0.0, 1.6);
			const core = new THREE.Mesh(this.padCoreGeometry, coreHandle.material);
			core.name = `VoidHeroHitPadCore_${i + 1}`;
			// Sit on the top cap of the prism (local Y = padPrismDepth) so it shares the press squeeze.
			core.position.y = this.padPrismDepth + 0.002;
			core.scale.setScalar(0);
			core.castShadow = false;
			core.receiveShadow = false;
			pad.add(core);
			this.padCoreHandles.push(coreHandle);
			this.padCoreMeshes.push(core);
		}

		for (let i = 0; i <= LANE_COUNT; i++) {
			const r = THREE.MathUtils.lerp(firstLaneLeft, lastLaneRight, i / LANE_COUNT);
			const handle = createGlowMaterial('#ffffff', 0.4, 1.35);
			const separator = new THREE.Mesh(
				createQuadGeometry(
					this.frame,
					r - separatorWidth * 0.5,
					r + separatorWidth * 0.5,
					this.frame.nearT,
					this.frame.farT,
					0.012
				),
				handle.material
			);
			separator.name = `VoidHeroSeparator_${i + 1}`;
			separator.receiveShadow = false;
			separator.castShadow = false;
			this.root.add(separator);
			this.separatorHandles.push(handle);
		}

		const hitHandle = createGlowMaterial('#ffffff', 0.8, 2.4);
		const hitLine = new THREE.Mesh(
			createQuadGeometry(
				this.frame,
				firstLaneLeft - separatorWidth,
				lastLaneRight + separatorWidth,
				this.frame.hitT - 0.045,
				this.frame.hitT + 0.045,
				0.02
			),
			hitHandle.material
		);
		hitLine.name = 'VoidHeroHitLine';
		this.root.add(hitLine);
		this.separatorHandles.push(hitHandle);
	}

	private buildFxPools(): void {
		this.hitRingPool = this.buildFxPool(this.fxRingGeometry, 8, 'VoidHeroFxRingPool');
		this.hitBeamPool = this.buildFxPool(this.fxBeamGeometry, 6, 'VoidHeroFxBeamPool');
		this.buildComboVfxPools();
	}

	private buildComboVfxPools(): void {
		const tex = this.config.comboVfx;
		if (!tex) return;
		this.comboBoltPool = this.buildFxPool(
			this.comboBoltGeometry,
			6,
			'VoidHeroComboBoltPool',
			tex.bolt,
			tex.boltAlt
		);
		this.comboImpactPool = this.buildFxPool(
			this.comboImpactGeometry,
			4,
			'VoidHeroComboImpactPool',
			tex.impact
		);
	}

	private buildFxPool(
		geometry: THREE.BufferGeometry,
		count: number,
		name: string,
		map?: THREE.Texture,
		mapAlt?: THREE.Texture
	): FxPool {
		const opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
		const intensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
		const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
		geometry.setAttribute('fxOpacity', opacityAttr);
		geometry.setAttribute('fxIntensity', intensityAttr);
		geometry.setAttribute('fxColor', colorAttr);

		// Only textured pools with a second frame need the per-slot frame selector.
		let variantAttr: THREE.InstancedBufferAttribute | undefined;
		if (mapAlt) {
			variantAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
			geometry.setAttribute('fxVariant', variantAttr);
		}

		const material = new MeshStandardNodeMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			roughness: 0.5,
			metalness: 0
		});
		const op = attribute('fxOpacity');
		const it = attribute('fxIntensity');
		const co = attribute('fxColor');
		material.colorNode = vec3(0, 0, 0);
		if (map) {
			// Grayscale TGA → luminance mask (.r). A second frame, when provided, is
			// selected per slot via fxVariant (0/1) so repeated strikes vary.
			const maskA = texture(map).r;
			const mask = mapAlt ? mix(maskA, texture(mapAlt).r, attribute('fxVariant')) : maskA;
			material.emissiveNode = co
				.mul(it as any)
				.mul(op as any)
				.mul(mask as any);
			material.opacityNode = op.mul(mask as any);
		} else {
			material.emissiveNode = co.mul(it as any).mul(op as any);
			material.opacityNode = op;
		}

		const mesh = new THREE.InstancedMesh(geometry, material, count);
		mesh.name = name;
		mesh.frustumCulled = false;
		mesh.visible = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		for (let i = 0; i < count; i++) mesh.setMatrixAt(i, this.fxHiddenMatrix);
		mesh.instanceMatrix.needsUpdate = true;
		this.root.add(mesh);

		const slots: FxSlot[] = [];
		for (let i = 0; i < count; i++) {
			slots.push({
				index: i,
				alive: false,
				life: 0,
				maxLife: 0,
				startScaleXZ: 1,
				endScaleXZ: 1,
				scaleY: 1,
				startOpacity: 1,
				startIntensity: 2,
				position: new THREE.Vector3(),
				quaternion: new THREE.Quaternion()
			});
		}
		return { mesh, opacityAttr, intensityAttr, colorAttr, variantAttr, slots };
	}

	private buildRimFlames(): void {
		const firstLaneLeft = this.frame.laneCenters[0] - this.frame.laneWidth * 0.5;
		const lastLaneRight =
			this.frame.laneCenters[this.frame.laneCenters.length - 1] + this.frame.laneWidth * 0.5;
		const flameWidth = this.frame.laneWidth * 0.95;
		const flameHeight = 2.6;
		const flameOffset = this.frame.laneWidth * 0.25;
		const baseLift = flameHeight * 0.5;
		const positions = [
			toWorld(
				this.frame,
				firstLaneLeft - flameOffset,
				this.frame.hitT,
				baseLift,
				new THREE.Vector3()
			),
			toWorld(
				this.frame,
				lastLaneRight + flameOffset,
				this.frame.hitT,
				baseLift,
				new THREE.Vector3()
			)
		];

		for (let i = 0; i < positions.length; i++) {
			const mesh = new THREE.Mesh(this.rimFlameGeometry, createRimFlameMaterial(this.rimFlameTime));
			mesh.name = `VoidHeroRimFlame_${i + 1}`;
			mesh.position.copy(positions[i]);
			mesh.quaternion.copy(this.frame.orientation);
			mesh.scale.set(flameWidth, flameHeight, 1);
			mesh.frustumCulled = false;
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			this.rimFlameMeshes.push(mesh);
			this.root.add(mesh);
		}
	}

	private updateReveal(delta: number): void {
		const reveal = this.transitionAmount;
		const beat = this.bassEnergy;

		for (let i = 0; i < this.laneHandles.length; i++) {
			const phase = THREE.MathUtils.clamp((this.introProgress - i * 0.045) / 0.56, 0, 1);
			const laneEase = easeOutCubic(phase);
			const pulse = this.lanePulses[i] ?? 0;
			this.laneHandles[i].opacity.value =
				this.laneHandles[i].baseOpacity * laneEase + pulse * 0.08 + beat * 0.05 * reveal;
			this.laneHandles[i].intensity.value =
				this.laneHandles[i].baseIntensity + pulse * 1.1 + beat * 0.7 * reveal;
			this.lanePulses[i] = Math.max(0, pulse - delta * 3.2);
		}

		for (let i = 0; i < this.separatorHandles.length; i++) {
			const phase = THREE.MathUtils.clamp((this.introProgress - 0.18 - i * 0.018) / 0.48, 0, 1);
			const separatorEase = easeOutCubic(phase);
			this.separatorHandles[i].opacity.value = this.separatorHandles[i].baseOpacity * separatorEase;
			this.separatorHandles[i].intensity.value =
				this.separatorHandles[i].baseIntensity * (0.8 + Math.sin(this.elapsed * 4 + i) * 0.08) +
				beat * 0.4 * reveal;
		}
	}

	private updatePads(delta: number): void {
		const reveal = this.transitionAmount;
		const beat = this.bassEnergy;
		const baseScale = this.frame.laneWidth * 0.46;
		// Exponential ramp: time-constant ≈ 1/rate, so attack reaches ~95% in ~3/rate seconds.
		// 9 → ~330ms charge; 20 → ~150ms release. Asymmetric on purpose: snappy let-go, satisfying build.
		const forceAttackRate = 9;
		const forceReleaseRate = 20;

		for (let i = 0; i < this.padHandles.length; i++) {
			const handle = this.padHandles[i];
			const press = this.padPulses[i];
			const approach = this.padApproach[i];
			const missFlash = this.padMissFlash[i];
			const corePulse = this.padCorePulse[i];
			const breath = (Math.sin(this.elapsed * 1.6 + i * 0.65) * 0.5 + 0.5) * reveal;
			const padReveal = easeOutCubic(
				THREE.MathUtils.clamp((this.introProgress - 0.42 - i * 0.025) / 0.42, 0, 1)
			);

			const forceTarget = this.laneHoldRefcount[i] > 0 ? 1 : 0;
			const forceRate = forceTarget > this.padForce[i] ? forceAttackRate : forceReleaseRate;
			this.padForce[i] = THREE.MathUtils.clamp(
				this.padForce[i] + (forceTarget - this.padForce[i]) * forceRate * delta,
				0,
				1
			);
			const force = this.padForce[i];
			const forceEase = THREE.MathUtils.smoothstep(force, 0, 1);

			// Split force into "good" (cyan-shift) vs "no-note" (red-shift). Mutually exclusive — only
			// one branch is non-zero at a time. Both scale linearly with force, so the chromatic
			// shift is the visible echo of how hard the pad is being charged.
			const forceCyan = this.padNoNote[i] ? 0 : forceEase;
			const forceRed = this.padNoNote[i] ? forceEase : 0;

			handle.opacity.value =
				handle.baseOpacity * padReveal +
				press * 0.48 * reveal +
				beat * 0.18 * reveal +
				approach * 0.34 * reveal +
				forceEase * 0.55 * reveal;
			handle.intensity.value =
				handle.baseIntensity +
				press * 2.8 +
				beat * 1.2 * reveal +
				approach * 2.15 +
				breath * 0.35 +
				missFlash * 1.4 +
				forceEase * 2.4;
			if (handle.tint) {
				// missFlash spike + sustained red while no-note held; cyan otherwise as force ramps.
				const redAmount = missFlash + forceRed;
				(handle.tint.value as THREE.Color).setRGB(
					1 + redAmount * 1.2 - forceCyan * 0.12,
					1 - redAmount * 0.75 + forceCyan * 0.22,
					1 - redAmount * 0.9 + forceCyan * 0.5
				);
			}

			// Two scale channels compose:
			//   • Y squeeze from padPulses — instant on press, decays. The "tap punch."
			//   • XZ inflate + Y lift from force — continuous "charging out" while the key is held.
			// The squeeze multiplies the lift so a fresh press still visibly sinks even mid-charge.
			const padMesh = this.padMeshes[i];
			const forceInflateXZ = 1 + forceEase * 0.14;
			const forceLift = 1 + forceEase * 0.22;
			padMesh.scale.set(
				baseScale * forceInflateXZ,
				baseScale * (1 - press * 0.6) * forceLift,
				baseScale * forceInflateXZ
			);

			// Subtle high-freq jitter on charge — adds a "tensioning" feel without disturbing the
			// perfect-hit twirl, which dominates whenever padRotation spikes.
			const forceJitter = Math.sin(this.elapsed * 24 + i * 1.7) * forceEase * 0.04;
			this.padRotScratch.setFromAxisAngle(this.padAxisScratch, this.padRotation[i] + forceJitter);
			padMesh.quaternion.copy(this.frame.orientation).multiply(this.padRotScratch);

			// Inner core: hold-fill goes to 1 when a note is locked; force-fill caps lower (0.78) so a
			// fully charged-but-uncommitted pad reads distinct from a locked hold.
			const target = this.holding[i] ? 1 : 0;
			this.padCoreFill[i] += (target - this.padCoreFill[i]) * Math.min(1, delta * 10);
			const coreFill = Math.max(this.padCoreFill[i], forceEase * 0.78);
			const coreHandle = this.padCoreHandles[i];
			const coreMesh = this.padCoreMeshes[i];
			coreMesh.scale.setScalar(coreFill);
			coreHandle.opacity.value = coreFill * (0.55 + corePulse * 0.45);
			coreHandle.intensity.value = 1.6 + corePulse * 2.6 + forceEase * 1.5;

			// Decays.
			this.padPulses[i] = Math.max(0, press - delta * 4.5);
			this.padMissFlash[i] = Math.max(0, missFlash - delta * 4.5);
			this.padCorePulse[i] = Math.max(0, corePulse - delta * 6);
			this.padRotation[i] *= Math.exp(-delta * 14);
			if (Math.abs(this.padRotation[i]) < 1e-4) this.padRotation[i] = 0;
		}
	}

	private spawnPattern(): void {
		// Free-running fallback only (no music). The music-locked path advances through
		// the curated progression bank — see advanceAndSpawnStep.
		const lanes = PATTERN[this.patternIndex % PATTERN.length];
		this.patternIndex++;

		for (const spec of lanes) {
			if (typeof spec === 'number') {
				this.spawnNote(spec, 0);
			} else {
				this.spawnNote(spec.lane, spec.hold ?? 0);
			}
		}
	}

	private advanceProgressionStep(): void {
		this.totalSteps++;
		const axes = getActiveAxes(this.totalSteps);
		const stageChanged = axes.stageName !== this.currentStageName;
		if (stageChanged) {
			if (this.currentStageName !== '') this.emitStageBanner(axes.stageName);
			this.currentStageName = axes.stageName;
		}
		this.currentAxes = axes;
		// Pull HUD updates so the stage progress bar advances without needing a hit.
		this.publishRunHud();
	}

	private advanceAndSpawnStep(): void {
		this.advanceProgressionStep();

		if (
			this.currentPattern === null ||
			this.patternStepCursor >= this.currentPattern.steps.length
		) {
			this.pickNextProgressionPattern();
		}

		const pattern = this.currentPattern;
		if (pattern) {
			const step = pattern.steps[this.patternStepCursor++];
			if (step) {
				for (const spec of step) {
					if (typeof spec === 'number') {
						this.spawnNote(spec, 0);
					} else {
						this.spawnNote(spec.lane, spec.hold ?? 0);
					}
				}
			}
		}
	}

	private pickNextProgressionPattern(): void {
		const stage = getStageForStep(this.totalSteps);
		const entry = pickNextPattern({
			stage,
			currentStep: this.totalSteps,
			history: this.patternHistory,
			lastBurstStep: this.lastBurstStep
		});
		this.currentPattern = entry;
		this.patternStepCursor = 0;
		this.patternHistory.push(entry.id);
		if (this.patternHistory.length > HISTORY_SIZE) this.patternHistory.shift();
		if (entry.kind === 'burst') this.lastBurstStep = this.totalSteps;
	}

	private emitStageBanner(name: string): void {
		const center = toWorld(
			this.frame,
			0,
			this.frame.hitT + this.frame.laneWidth * 0.4,
			0.9,
			new THREE.Vector3()
		);
		this.emitPopup(name.toUpperCase(), 'milestone', center);
		this.config.onCameraShake?.(1.4);
		this.playSfx('combo_milestone');
	}

	private spawnNote(lane: number, hold = 0): void {
		const group = new THREE.Group();
		group.name = `VoidHeroNote_${lane + 1}`;
		const ring = new THREE.Mesh(this.noteRingGeometry, this.noteRingMaterial);
		ring.castShadow = false;
		ring.receiveShadow = false;
		group.add(ring);
		const core = new THREE.Mesh(this.noteCoreGeometry, this.noteCoreMaterial);
		// Lift the core a hair so it doesn't z-fight with the lane plane.
		core.position.y = 0.005;
		core.castShadow = false;
		core.receiveShadow = false;
		group.add(core);

		group.quaternion.copy(this.frame.orientation);
		group.scale.setScalar(this.frame.laneWidth * 0.42);

		let tailMesh: THREE.Mesh | null = null;
		let trailMesh: THREE.Mesh | null = null;
		if (hold > 0) {
			tailMesh = new THREE.Mesh(this.holdTailGeometry, this.holdTailMaterial);
			tailMesh.name = `VoidHeroHoldTail_${lane + 1}`;
			tailMesh.castShadow = false;
			tailMesh.receiveShadow = false;
			tailMesh.frustumCulled = false;
			tailMesh.renderOrder = -1;
			this.root.add(tailMesh);
		} else {
			// Approach trail: short additive streak behind non-hold notes. Reuses the
			// hold-tail plane geometry (already rotated flat with Z spanning [0, 1]).
			trailMesh = new THREE.Mesh(this.holdTailGeometry, this.noteTrailMaterial);
			trailMesh.name = `VoidHeroNoteTrail_${lane + 1}`;
			trailMesh.castShadow = false;
			trailMesh.receiveShadow = false;
			trailMesh.frustumCulled = false;
			trailMesh.renderOrder = -1;
			this.root.add(trailMesh);
		}

		const note: GameNote = {
			group,
			lane,
			travel: this.frame.farT,
			hold,
			holdLengthT: hold * this.getNoteSpeed(),
			tailMesh,
			trailMesh,
			ringMesh: ring,
			coreMesh: core,
			headHit: false
		};
		this.updateNotePosition(note);
		if (hold > 0) this.updateHoldVisual(note);
		else this.updateNoteTrail(note, this.getNoteSpeed());
		this.root.add(group);
		this.notes.push(note);
	}

	private updateNoteTrail(note: GameNote, noteSpeed: number): void {
		if (!note.trailMesh) return;
		// Trail extends BEHIND the note (away from camera, toward farT). Length is
		// proportional to current speed so faster waves leave longer streaks.
		const trailLength = THREE.MathUtils.clamp(noteSpeed * 0.07, 0.25, 0.7);
		const tailNear = note.travel;
		const tailFar = Math.min(note.travel + trailLength, this.frame.farT);
		const length = tailFar - tailNear;
		if (length > 0.02) {
			note.trailMesh.visible = true;
			toWorld(
				this.frame,
				this.frame.laneCenters[note.lane],
				tailNear,
				0.04,
				note.trailMesh.position
			);
			note.trailMesh.quaternion.copy(this.frame.orientation);
			note.trailMesh.scale.set(this.frame.laneWidth * 0.22, 1, length);
		} else {
			note.trailMesh.visible = false;
		}
	}

	private updateHoldVisual(note: GameNote): void {
		if (!note.tailMesh) return;
		// note.travel is the head position; the tail extends from the head AWAY from
		// the camera (toward larger T) by holdLengthT. Clamping tailFar to farT means
		// at spawn (head at farT) the tail has length 0 and grows as the head advances.
		const headT = note.travel;
		const endT = this.getHoldEndT(note);
		const tailNear = Math.max(note.headHit ? this.frame.hitT : headT, this.frame.hitT);
		const tailFar = Math.min(endT, this.frame.farT);
		const tailLength = tailFar - tailNear;

		if (tailLength > 0.02) {
			note.tailMesh.visible = true;
			toWorld(
				this.frame,
				this.frame.laneCenters[note.lane],
				tailNear,
				0.04,
				note.tailMesh.position
			);
			note.tailMesh.quaternion.copy(this.frame.orientation);
			note.tailMesh.scale.set(this.frame.laneWidth * 0.28, 1, tailLength);
		} else {
			note.tailMesh.visible = false;
		}
	}

	private getHoldEndT(note: GameNote): number {
		return note.travel + note.holdLengthT;
	}

	private getHitTargetT(note: GameNote): number {
		return note.travel;
	}

	private getHitTargetPosition(note: GameNote): THREE.Vector3 {
		return toWorld(
			this.frame,
			this.frame.laneCenters[note.lane],
			this.getHitTargetT(note),
			0.06,
			new THREE.Vector3()
		);
	}

	private getNoteSpeed(): number {
		return this.baseNoteSpeed * this.currentAxes.speedMul;
	}

	private getBeatInterval(): number {
		// Free-running fallback only — music path is BPM-locked. Keeps the legacy
		// "ramp slightly with score" feel for the no-music selection.
		return THREE.MathUtils.clamp(
			this.baseBeatInterval - this.score * 0.004,
			this.minBeatInterval,
			this.baseBeatInterval
		);
	}

	private getHitWindow(): number {
		return Math.max(this.minHitWindow, this.baseHitWindow * this.currentAxes.hitWindowScale);
	}

	private canReleaseHold(note: GameNote): boolean {
		return (
			this.getHoldEndT(note) <= this.frame.hitT + this.getNoteSpeed() * this.holdReleaseLeadTime
		);
	}

	private updateNotes(delta: number): void {
		const noteSpeed = this.getNoteSpeed();
		const hitWindow = this.getHitWindow();
		const approachWindow = 2.65 * hitWindow;
		this.padApproach.fill(0);
		for (let i = this.notes.length - 1; i >= 0; i--) {
			const note = this.notes[i];
			note.travel -= noteSpeed * delta;
			this.updateNotePosition(note);

			if (note.hold > 0) {
				this.updateHoldVisual(note);
			} else {
				this.updateNoteTrail(note, noteSpeed);
			}

			// Anticipation glow: closer = brighter pad. Skip already-hit hold heads.
			if (!note.headHit) {
				const distance = note.travel - this.frame.hitT;
				if (distance > 0 && distance < approachWindow) {
					const factor = 1 - distance / approachWindow;
					if (factor > this.padApproach[note.lane]) {
						this.padApproach[note.lane] = factor;
					}
				}
			}

			if (note.headHit && note.hold > 0) {
				// Hold being sustained — accumulate score, pin pad pulse, check completion.
				const slot = this.holding[note.lane];
				if (!slot || slot.note !== note) {
					this.removeNoteAt(i);
					continue;
				}

				slot.scoreAccumulator += delta;
				let scoreChanged = false;
				while (slot.scoreAccumulator >= this.holdScoreInterval) {
					slot.scoreAccumulator -= this.holdScoreInterval;
					this.score += this.applyScoreMul(1);
					this.padCorePulse[note.lane] = 1;
					scoreChanged = true;
				}
				this.padPulses[note.lane] = Math.max(this.padPulses[note.lane], 0.9);
				if (scoreChanged) this.publishRunHud();

				if (this.getHoldEndT(note) <= this.frame.hitT) {
					this.completeHold(note);
				}
				continue;
			}

			if (this.getHitTargetT(note) < this.frame.hitT - hitWindow) {
				this.applyMissPenalty('Miss');
				this.playSfx('miss');
				this.spawnMissBurst(this.getHitTargetPosition(note));
				this.config.onCameraShake?.(0.2);
				this.removeNoteAt(i);
			}
		}
	}

	private updateNotePosition(note: GameNote): void {
		toWorld(this.frame, this.frame.laneCenters[note.lane], note.travel, 0.06, note.group.position);
	}

	private hitLane(lane: number, source: InputSource): void {
		// Already mid-hold in this lane — ignore re-presses.
		if (this.holding[lane]) return;

		this.padPulses[lane] = 1;
		this.lanePulses[lane] = 1;

		let bestIndex = -1;
		let bestDistance = Infinity;

		for (let i = 0; i < this.notes.length; i++) {
			const note = this.notes[i];
			if (note.lane !== lane) continue;
			if (note.headHit) continue;
			const distance = Math.abs(this.getHitTargetT(note) - this.frame.hitT);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = i;
			}
		}

		const hitWindow = this.getHitWindow();
		if (bestIndex >= 0 && bestDistance <= hitWindow) {
			this.padNoNote[lane] = false;
			const note = this.notes[bestIndex];
			const hitPosition = this.getHitTargetPosition(note);
			const accuracy = 1 - bestDistance / hitWindow;
			const isPerfect = accuracy > 0.72;
			this.combo += 1;
			this.score += this.applyScoreMul(isPerfect ? 2 : 1);
			this.maybeAwardLifeFromCombo();
			this.hudMessage = note.hold > 0 ? 'Holding' : isPerfect ? 'Perfect' : 'Nice';
			this.spawnHitBurst(hitPosition, isPerfect);
			this.playSfx(isPerfect ? 'hit_perfect' : 'hit_nice');
			this.config.onCameraShake?.(isPerfect ? 1.0 : 0.5);
			if (isPerfect) this.padRotation[lane] = Math.PI / 8;
			this.emitHitPopup(this.combo, isPerfect, hitPosition);
			this.spawnComboVfx(this.combo, isPerfect, hitPosition);
			if (this.combo > 0 && this.combo % 10 === 0) {
				this.playSfx('combo_milestone');
			}

			if (note.hold > 0) {
				// Latch the visible hold head at the pad; only the sustain body remains afterward.
				note.headHit = true;
				if (note.ringMesh) note.ringMesh.visible = false;
				if (note.coreMesh) note.coreMesh.visible = false;
				this.holding[lane] = { note, source, scoreAccumulator: 0 };
				this.emitPopup(
					'Holding',
					'judgment',
					hitPosition.clone().addScaledVector(this.frame.up, 0.28)
				);
			} else {
				this.removeNoteAt(bestIndex);
			}

			this.publishRunHud();
			return;
		}

		this.combo = 0;
		this.lastComboLifeMilestone = 0;
		this.hudMessage = 'Early';
		this.padMissFlash[lane] = 1;
		this.padNoNote[lane] = true;
		this.playSfx('early');
		this.publishRunHud();
	}

	private releaseHold(lane: number, source?: InputSource): void {
		const slot = this.holding[lane];
		if (!slot || (source && slot.source !== source)) return;

		if (this.canReleaseHold(slot.note)) {
			this.completeHold(slot.note);
			return;
		}

		this.breakHold(lane);
	}

	private completeHold(note: GameNote): void {
		this.score += this.applyScoreMul(this.holdCompletionBonus);
		this.hudMessage = 'Complete';
		this.playSfx('combo_milestone');
		this.config.onCameraShake?.(1.2);
		const popupPos = toWorld(
			this.frame,
			this.frame.laneCenters[note.lane],
			this.frame.hitT,
			0.4,
			new THREE.Vector3()
		);
		this.emitPopup('Complete', 'milestone', popupPos);
		if (this.holding[note.lane]?.note === note) {
			this.holding[note.lane] = null;
		}
		const index = this.notes.indexOf(note);
		if (index >= 0) this.removeNoteAt(index);
		this.publishRunHud();
	}

	private breakHold(lane: number): void {
		const slot = this.holding[lane];
		if (!slot) return;
		const note = slot.note;
		const index = this.notes.indexOf(note);
		this.applyMissPenalty('Released Early');
		this.playSfx('miss');
		this.config.onCameraShake?.(0.4);
		const popupPos = toWorld(
			this.frame,
			this.frame.laneCenters[lane],
			this.frame.hitT,
			0.4,
			new THREE.Vector3()
		);
		this.emitPopup('Released Early', 'judgment', popupPos);
		this.holding[lane] = null;
		if (index >= 0) this.removeNoteAt(index);
	}

	private applyMissPenalty(message: string): void {
		if (this.gameOver) return;

		this.combo = 0;
		this.lastComboLifeMilestone = 0;
		this.lives = Math.max(0, this.lives - 1);
		this.hudMessage = message;
		// Subtle extra punch each time a heart breaks — additive on top of the caller's miss/early shake
		// so the player feels the life loss distinct from a generic mis-tap.
		this.config.onCameraShake?.(0.35);
		this.playSfx('heart_break');
		this.publishRunHud();

		if (this.lives <= 0) {
			this.triggerGameOver();
		}
	}

	private triggerGameOver(): void {
		if (this.gameOver) return;

		this.gameOver = true;
		this.playing = false;
		this.hudMessage = 'Game loose';
		// Persist run records before the final HUD push so the game-over panel sees them.
		if (this.score > this.bestScore) {
			this.bestScore = this.score;
			this.writeStoredBestScore(this.score);
		}
		if (this.totalSteps > this.bestStageSteps) {
			this.bestStageSteps = this.totalSteps;
			this.writeStoredBestStageSteps(this.totalSteps);
		}
		this.publishRunHud('Game loose');
		window.setTimeout(() => this.config.events.emit({ kind: 'gameOver' }), 0);
	}

	private applyScoreMul(base: number): number {
		const mul = this.isMusicSpawning() ? this.currentAxes.scoreMul : 1;
		return Math.max(1, Math.round(base * mul));
	}

	private maybeAwardLifeFromCombo(): void {
		const tier = Math.floor(this.combo / COMBO_LIFE_REGEN_STEP);
		const lastTier = Math.floor(this.lastComboLifeMilestone / COMBO_LIFE_REGEN_STEP);
		if (tier <= lastTier) return;
		this.lastComboLifeMilestone = tier * COMBO_LIFE_REGEN_STEP;
		if (this.lives >= MAX_LIVES) return;
		this.lives++;
		const center = toWorld(
			this.frame,
			0,
			this.frame.hitT + this.frame.laneWidth * 0.6,
			0.65,
			new THREE.Vector3()
		);
		this.emitPopup('+1 LIFE', 'milestone', center);
		this.playSfx('combo_milestone');
	}

	private emitHitPopup(combo: number, isPerfect: boolean, position: THREE.Vector3): void {
		let text: string;
		let tier: PopupTier;
		if (combo >= 100 && combo % 100 === 0) {
			text = `x${combo} ⚡`;
			tier = 'milestone';
		} else if (combo === 50) {
			text = 'x50!!!';
			tier = 'milestone';
		} else if (combo === 25) {
			text = 'x25!!';
			tier = 'milestone';
		} else if (combo === 10) {
			text = 'x10!';
			tier = 'milestone';
		} else if (combo >= 2) {
			text = `x${combo}`;
			tier = 'combo';
		} else {
			text = isPerfect ? 'Perfect' : 'Nice';
			tier = 'judgment';
		}
		this.emitPopup(text, tier, position);
	}

	private spawnHitBurst(position: THREE.Vector3, isPerfect: boolean): void {
		const burstColor =
			this.combo >= 100
				? this.hitColorHot
				: this.combo >= 25
					? this.hitColorGold
					: this.hitColorWhite;
		const ringStart = this.frame.laneWidth * 0.55;
		const ringEnd = this.frame.laneWidth * (isPerfect ? 1.4 : 1.15);
		this.activateFxSlot(this.hitRingPool, position, {
			maxLife: 0.45,
			startScaleXZ: ringStart,
			endScaleXZ: ringEnd,
			scaleY: 1,
			startOpacity: 1,
			startIntensity: isPerfect ? 2.8 : 2.2,
			yOffset: 0.012,
			color: burstColor
		});

		const beamWidth = this.frame.laneWidth * 0.28;
		const beamHeight = isPerfect ? 1.2 : 0.9;
		this.activateFxSlot(this.hitBeamPool, position, {
			maxLife: 0.32,
			startScaleXZ: beamWidth,
			endScaleXZ: beamWidth * 0.2,
			scaleY: beamHeight,
			startOpacity: 0.95,
			startIntensity: 3.2,
			yOffset: beamHeight * 0.5,
			color: burstColor
		});

		const sparkCount = isPerfect ? 14 : 10;
		for (let i = 0; i < sparkCount; i++) {
			const baseScale = THREE.MathUtils.randFloat(0.04, 0.09);
			const side = THREE.MathUtils.randFloatSpread(0.55);
			const lift = THREE.MathUtils.randFloat(0.25, 0.95);
			const drift = THREE.MathUtils.randFloat(-0.35, 0.25);
			const maxLife = THREE.MathUtils.randFloat(0.3, 0.55);
			this.spawnSpark(position, side, lift, drift, baseScale, maxLife);
		}
	}

	private spawnMissBurst(position: THREE.Vector3): void {
		this.activateFxSlot(this.hitRingPool, position, {
			maxLife: 0.32,
			startScaleXZ: this.frame.laneWidth * 0.5,
			endScaleXZ: this.frame.laneWidth * 0.22,
			scaleY: 1,
			startOpacity: 0.55,
			startIntensity: 0.9,
			yOffset: 0.012
		});

		for (let i = 0; i < 3; i++) {
			const baseScale = THREE.MathUtils.randFloat(0.022, 0.036);
			const side = THREE.MathUtils.randFloatSpread(0.8);
			const lift = THREE.MathUtils.randFloat(-0.2, 0.4);
			const drift = THREE.MathUtils.randFloat(-0.6, 0.2);
			const maxLife = THREE.MathUtils.randFloat(0.22, 0.36);
			this.spawnSpark(position, side, lift, drift, baseScale, maxLife);
		}
	}

	/**
	 * Combo lightning. Small arc on every perfect hit once the combo is rolling; a bigger,
	 * tier-colored bolt + ground impact at the milestone thresholds the popups celebrate.
	 * No-op until the host injects the textures (this.comboBoltPool stays null).
	 */
	private spawnComboVfx(combo: number, isPerfect: boolean, position: THREE.Vector3): void {
		if (!this.comboBoltPool) return;
		const milestone =
			combo === 10 || combo === 25 || combo === 50 || (combo >= 100 && combo % 100 === 0);

		if (milestone) {
			const color =
				combo >= 100 ? this.hitColorHot : combo >= 25 ? this.hitColorGold : this.hitColorWhite;
			this.spawnComboBolt(position, color, true);
		} else if (isPerfect && combo >= this.comboArcThreshold) {
			this.spawnComboBolt(position, this.comboArcColor, false);
		}
	}

	private spawnComboBolt(position: THREE.Vector3, color: THREE.Color, big: boolean): void {
		const pool = this.comboBoltPool;
		if (!pool) return;
		const width = this.frame.laneWidth * (big ? 0.9 : 0.45);
		const height = this.frame.laneWidth * (big ? 3.6 : 1.8);
		this.assignFxVariant(
			pool,
			this.activateFxSlot(pool, position, {
				maxLife: big ? 0.42 : 0.22,
				startScaleXZ: width,
				endScaleXZ: width,
				scaleY: height,
				startOpacity: big ? 1 : 0.75,
				startIntensity: big ? 3.6 : 2.2,
				yOffset: 0,
				color
			})
		);

		if (big && this.comboImpactPool) {
			const impactSize = this.frame.laneWidth * 1.8;
			this.activateFxSlot(this.comboImpactPool, position, {
				maxLife: 0.34,
				startScaleXZ: impactSize * 0.5,
				endScaleXZ: impactSize,
				scaleY: 1,
				startOpacity: 1,
				startIntensity: 3,
				yOffset: 0.014,
				color
			});
		}
	}

	private assignFxVariant(pool: FxPool, slot: FxSlot | null): void {
		if (!slot || !pool.variantAttr) return;
		pool.variantAttr.array[slot.index] = Math.random() < 0.5 ? 0 : 1;
		pool.variantAttr.needsUpdate = true;
	}

	private spawnSpark(
		origin: THREE.Vector3,
		side: number,
		lift: number,
		drift: number,
		baseScale: number,
		maxLife: number
	): void {
		const spark = new THREE.Mesh(this.sparkGeometry, this.sparkMaterial);
		spark.name = 'VoidHeroSpark';
		spark.position.copy(origin);
		spark.quaternion.copy(this.frame.orientation);
		spark.scale.setScalar(baseScale);
		const velocity = new THREE.Vector3()
			.addScaledVector(this.frame.right, side)
			.addScaledVector(this.frame.up, lift)
			.addScaledVector(this.frame.forward, drift);
		this.root.add(spark);
		this.sparks.push({
			mesh: spark,
			velocity,
			life: maxLife,
			maxLife,
			baseScale
		});
	}

	private activateFxSlot(
		pool: FxPool,
		position: THREE.Vector3,
		opts: {
			maxLife: number;
			startScaleXZ: number;
			endScaleXZ: number;
			scaleY: number;
			startOpacity: number;
			startIntensity: number;
			yOffset?: number;
			color?: THREE.Color;
		}
	): FxSlot | null {
		const slot = pool.slots.find((s) => !s.alive);
		if (!slot) return null;
		slot.alive = true;
		slot.life = opts.maxLife;
		slot.maxLife = opts.maxLife;
		slot.startScaleXZ = opts.startScaleXZ;
		slot.endScaleXZ = opts.endScaleXZ;
		slot.scaleY = opts.scaleY;
		slot.startOpacity = opts.startOpacity;
		slot.startIntensity = opts.startIntensity;
		slot.position.copy(position);
		if (opts.yOffset !== undefined) {
			slot.position.addScaledVector(this.frame.up, opts.yOffset);
		}
		slot.quaternion.copy(this.frame.orientation);

		const color = opts.color ?? this.hitColorWhite;
		const c = slot.index * 3;
		pool.colorAttr.array[c] = color.r;
		pool.colorAttr.array[c + 1] = color.g;
		pool.colorAttr.array[c + 2] = color.b;
		pool.colorAttr.needsUpdate = true;
		this.writeFxSlot(pool, slot, opts.startOpacity, opts.startIntensity, opts.startScaleXZ);
		pool.mesh.visible = true;
		return slot;
	}

	private writeFxSlot(
		pool: FxPool,
		slot: FxSlot,
		opacity: number,
		intensity: number,
		scaleXZ: number
	): void {
		pool.opacityAttr.array[slot.index] = opacity;
		pool.intensityAttr.array[slot.index] = intensity;
		pool.opacityAttr.needsUpdate = true;
		pool.intensityAttr.needsUpdate = true;
		const m = this.fxMatrixScratch.compose(
			slot.position,
			slot.quaternion,
			this.fxScaleScratch.set(scaleXZ, slot.scaleY, scaleXZ)
		);
		pool.mesh.setMatrixAt(slot.index, m);
		pool.mesh.instanceMatrix.needsUpdate = true;
	}

	private updateFxPool(pool: FxPool, delta: number): void {
		let anyAlive = false;
		for (const slot of pool.slots) {
			if (!slot.alive) continue;
			slot.life -= delta;
			if (slot.life <= 0) {
				slot.alive = false;
				pool.opacityAttr.array[slot.index] = 0;
				pool.opacityAttr.needsUpdate = true;
				pool.mesh.setMatrixAt(slot.index, this.fxHiddenMatrix);
				pool.mesh.instanceMatrix.needsUpdate = true;
				continue;
			}
			anyAlive = true;
			const t = 1 - slot.life / slot.maxLife;
			const ease = easeOutCubic(t);
			const scaleXZ = THREE.MathUtils.lerp(slot.startScaleXZ, slot.endScaleXZ, ease);
			const fade = 1 - ease;
			this.writeFxSlot(
				pool,
				slot,
				slot.startOpacity * fade,
				slot.startIntensity * (0.4 + 0.6 * fade),
				scaleXZ
			);
		}
		if (!anyAlive) pool.mesh.visible = false;
	}

	private updateSparks(delta: number): void {
		for (let i = this.sparks.length - 1; i >= 0; i--) {
			const spark = this.sparks[i];
			spark.life -= delta;
			spark.velocity.y -= delta * 1.6;
			spark.mesh.position.addScaledVector(spark.velocity, delta);
			spark.mesh.rotation.x += delta * 5;
			spark.mesh.rotation.y += delta * 4;

			// Shared spark material can't drive per-instance opacity, so we fade by shrinking.
			// Bloom on the bright emissive carries the visual until the mesh is sub-pixel.
			const fade = THREE.MathUtils.clamp(spark.life / spark.maxLife, 0, 1);
			spark.mesh.scale.setScalar(spark.baseScale * fade);

			if (spark.life <= 0) {
				this.root.remove(spark.mesh);
				this.sparks.splice(i, 1);
			}
		}
	}

	private removeNoteAt(index: number): void {
		const [note] = this.notes.splice(index, 1);
		if (this.holding[note.lane]?.note === note) {
			this.holding[note.lane] = null;
		}
		this.root.remove(note.group);
		if (note.tailMesh) this.root.remove(note.tailMesh);
		if (note.trailMesh) this.root.remove(note.trailMesh);
	}

	private publishRunHud(message = this.hudMessage): void {
		const progressionActive = this.isMusicSpawning();
		const stageName = progressionActive ? this.currentStageName || this.currentAxes.stageName : '';
		const stageProgress = progressionActive ? this.currentAxes.progressToNext : 0;
		const bestStageName = getStageForStep(this.bestStageSteps).name;
		this.config.events.emit({
			kind: 'runHud',
			state: {
				active: this.playing,
				score: this.score,
				combo: this.combo,
				message,
				laneLabels: [...LANE_LABELS],
				stageName,
				stageProgress,
				progressionActive,
				lives: this.lives,
				maxLives: MAX_LIVES,
				heartStages: this.heartStageDisplay.slice(),
				bestScore: this.bestScore,
				bestStage: bestStageName
			}
		});
	}

	private publishMusicState(): void {
		this.config.events.emit({
			kind: 'music',
			state: {
				muted: this.muted,
				tracks: MUSIC_TRACKS,
				currentTrackId: this.currentTrack.id,
				volume: this.musicVolume
			}
		});
	}

	private emitPopup(text: string, tier: PopupTier, worldPosition: THREE.Vector3): void {
		this.popupProjScratch.copy(worldPosition).project(this.config.camera);
		const x = (this.popupProjScratch.x + 1) * 0.5 * window.innerWidth;
		const y = (1 - this.popupProjScratch.y) * 0.5 * window.innerHeight;
		this.config.events.emit({ kind: 'popup', popup: { text, tier, x, y } });
	}

	// All SFX (synth blips + sampled heart-break) route through masterGain, so this is the
	// single knob that lets the music mixer's volume slider also scale game sounds.
	// 0.5× keeps the default slider (0.55) close to the original fixed 0.3 SFX level.
	private getSfxGainTarget(): number {
		return this.muted ? 0 : 0.5 * this.musicVolume;
	}

	private ensureAudio(): void {
		if (this.audioCtx) return;
		const Ctor: typeof AudioContext | undefined =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return;
		try {
			const ctx = new Ctor();
			const gain = ctx.createGain();
			gain.gain.value = this.getSfxGainTarget();
			gain.connect(ctx.destination);
			this.audioCtx = ctx;
			this.masterGain = gain;
			void this.loadHeartBreakSfx();
		} catch {
			this.audioCtx = null;
			this.masterGain = null;
		}
	}

	private async loadHeartBreakSfx(): Promise<void> {
		if (this.heartBreakBuffer || this.heartBreakLoading || !this.audioCtx) return;
		this.heartBreakLoading = true;
		try {
			const response = await fetch('/sounds/voidhero/heart-break.ogg');
			if (!response.ok) return;
			const arrayBuffer = await response.arrayBuffer();
			this.heartBreakBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
		} catch {
			/* fetch or decode failed — playSfx will fall back to the synth blip */
		} finally {
			this.heartBreakLoading = false;
		}
	}

	private resolveTrack(id: string | null): MusicTrack {
		return (
			MUSIC_TRACKS.find((t) => t.id === id) ??
			MUSIC_TRACKS.find((t) => t.id === DEFAULT_TRACK_ID) ??
			MUSIC_TRACKS[0]
		);
	}

	private isMusicSpawning(): boolean {
		return !!this.musicAudio && this.currentTrack.bpm > 0 && !this.musicAudio.paused;
	}

	private startMusic(): void {
		if (this.currentTrack.bpm <= 0 || !this.currentTrack.src) return;
		this.loadAndPlayTrack(this.currentTrack);
	}

	private loadAndPlayTrack(track: MusicTrack): void {
		this.stopMusic();
		if (track.bpm <= 0 || !track.src) return;
		this.ensureAudio();
		const audio = new Audio(track.src);
		audio.loop = true;
		audio.crossOrigin = 'anonymous';
		audio.preload = 'auto';
		audio.volume = this.muted ? 0 : 1;
		this.musicAudio = audio;

		if (this.audioCtx) {
			try {
				const source = this.audioCtx.createMediaElementSource(audio);
				const gain = this.audioCtx.createGain();
				gain.gain.value = this.muted ? 0 : this.musicVolume;
				const analyser = this.audioCtx.createAnalyser();
				analyser.fftSize = 256;
				analyser.smoothingTimeConstant = 0.65;
				source.connect(analyser);
				analyser.connect(gain);
				gain.connect(this.audioCtx.destination);
				this.musicSourceNode = source;
				this.musicGain = gain;
				this.musicAnalyser = analyser;
				this.musicFreqData = new Uint8Array(analyser.frequencyBinCount);
				audio.volume = 1;
			} catch {
				audio.volume = this.muted ? 0 : this.musicVolume;
			}
		}

		this.nextSpawnTime = null;
		this.chartCursor = 0;
		this.chartAudioPass = 0;
		this.chartNotePass = 0;
		this.chartLastArrival = null;
		const playPromise = audio.play();
		if (playPromise && typeof playPromise.catch === 'function') {
			playPromise.catch(() => {
				// Autoplay was blocked or playback failed — keep the track selected so the
				// player can retry via the UI; spawn loop falls back to free-running.
			});
		}
	}

	private stopMusic(): void {
		if (this.musicAudio) {
			try {
				this.musicAudio.pause();
				this.musicAudio.src = '';
			} catch {
				/* element already detached */
			}
			this.musicAudio = null;
		}
		this.musicSourceNode?.disconnect();
		this.musicGain?.disconnect();
		this.musicAnalyser?.disconnect();
		this.musicSourceNode = null;
		this.musicGain = null;
		this.musicAnalyser = null;
		this.musicFreqData = null;
		this.bassEnergy = 0;
	}

	private updateMusicSpawn(): void {
		if (!this.musicAudio || this.currentTrack.bpm <= 0) return;
		const secPerBeat = 60 / this.currentTrack.bpm;
		// Chart mode: the beat clock only paces stage progression (1 step = 1 beat);
		// notes spawn from the chart cursor below.
		const baseStepBeats = this.currentChart ? 1 : Math.max(0.25, this.currentTrack.beatsPerStep);
		const trackTime = this.musicAudio.currentTime - this.currentTrack.beatOffsetSec;
		const travelTime = (this.frame.farT - this.frame.hitT) / this.getNoteSpeed();
		const arrivalTime = trackTime + travelTime;
		const baseStepSec = secPerBeat * baseStepBeats;

		// First sync — anchor next-spawn arrival to the nearest aligned step boundary at or
		// before now, so the very next tick fires immediately and subsequent steps land on-beat.
		// Also re-anchor when the looping audio wraps (currentTime snaps back to 0); without
		// this the spawn clock would stall for a full pass after every loop.
		if (this.nextSpawnTime === null || arrivalTime < this.nextSpawnTime - baseStepSec * 2) {
			this.nextSpawnTime = Math.floor(arrivalTime / baseStepSec) * baseStepSec;
		}

		// Bounded loop: a frame stall could otherwise drown us in catch-up spawns.
		let safety = 32;
		while (safety-- > 0 && arrivalTime >= this.nextSpawnTime) {
			if (this.currentChart) {
				this.advanceProgressionStep();
				this.nextSpawnTime += baseStepSec;
			} else {
				this.advanceAndSpawnStep();
				const patternBeats = this.currentPattern?.beatsPerStep ?? baseStepBeats;
				this.nextSpawnTime += secPerBeat * Math.max(0.25, patternBeats);
			}
		}

		if (this.currentChart) this.updateChartSpawn(this.currentChart);
	}

	/**
	 * Spawn notes from the music-derived chart. Chart times are absolute seconds
	 * into the audio file; a note spawns when its arrival time (file time at
	 * which it must reach the hit line) crosses the current arrival horizon.
	 * The audio element loops, so a pass counter keeps the cursor's virtual
	 * timeline monotonic across wraps.
	 */
	private updateChartSpawn(chart: TrackChart): void {
		if (!this.musicAudio || chart.notes.length === 0) return;
		const travelTime = (this.frame.farT - this.frame.hitT) / this.getNoteSpeed();
		const arrival = this.musicAudio.currentTime + travelTime;

		if (this.chartLastArrival === null) {
			// First sync: skip notes already inside the arrival horizon — they would
			// spawn mid-lane. The chart picks up cleanly from here on.
			this.chartCursor = chart.notes.findIndex((n) => n.time >= arrival);
			if (this.chartCursor < 0) {
				this.chartCursor = 0;
				this.chartNotePass = 1;
			}
		} else if (arrival < this.chartLastArrival - chart.durationSec * 0.5) {
			// Audio looped.
			this.chartAudioPass++;
		}
		this.chartLastArrival = arrival;

		const virtualArrival = arrival + this.chartAudioPass * chart.durationSec;
		const stage = getStageForStep(this.totalSteps);
		// Run warm-up mirrors the pattern picker: stay sparse while hands find the keys.
		const density = this.totalSteps < 16 ? Math.min(stage.densityBias, 0.12) : stage.densityBias;
		const gate = chartSalienceGate(chart, density);
		// Chords unlock with the stage, like the pattern bank — before that a
		// chart chord collapses to its strongest note.
		const allowChords = stage.allowedKinds.includes('chord');

		let safety = 64;
		while (safety-- > 0) {
			const note = chart.notes[this.chartCursor];
			if (!note) break;
			if (note.time + this.chartNotePass * chart.durationSec > virtualArrival) break;

			// Consume the whole chord cluster (same chart time, adjacent by construction).
			let clusterEnd = this.chartCursor + 1;
			while (clusterEnd < chart.notes.length && chart.notes[clusterEnd].time === note.time) {
				clusterEnd++;
			}
			let best: (typeof chart.notes)[number] | null = null;
			let second: (typeof chart.notes)[number] | null = null;
			for (let i = this.chartCursor; i < clusterEnd; i++) {
				const candidate = chart.notes[i];
				if (candidate.salience < gate) continue;
				if (!best || candidate.salience > best.salience) {
					second = best;
					best = candidate;
				} else if (!second || candidate.salience > second.salience) {
					second = candidate;
				}
			}
			if (best) this.spawnNote(best.lane, best.holdSec);
			if (second && allowChords) this.spawnNote(second.lane, second.holdSec);

			this.chartCursor = clusterEnd;
			if (this.chartCursor >= chart.notes.length) {
				this.chartCursor = 0;
				this.chartNotePass++;
			}
		}
	}

	private sampleBassEnergy(delta: number): void {
		if (!this.musicAnalyser || !this.musicFreqData) {
			this.bassEnergy = Math.max(0, this.bassEnergy - delta * 4);
			return;
		}
		this.musicAnalyser.getByteFrequencyData(this.musicFreqData);
		// fftSize 256 @ ~44.1kHz → ~172 Hz/bin; bins 0..3 cover ~0-700 Hz (kick + bass body).
		let sum = 0;
		const bandEnd = 4;
		for (let i = 0; i < bandEnd; i++) sum += this.musicFreqData[i];
		const avg = sum / bandEnd / 255;
		// Asymmetric smoothing: rise fast on a kick, decay slowly so the pulse feels punchy.
		const target = Math.min(1, avg * 1.35);
		const k = target > this.bassEnergy ? 1 : Math.min(1, delta * 5.5);
		this.bassEnergy += (target - this.bassEnergy) * k;
	}

	setTrack(id: string): void {
		const next = this.resolveTrack(id);
		if (next.id === this.currentTrack.id && this.musicAudio) return;
		this.currentTrack = next;
		this.currentChart = getChartForTrack(next.id);
		try {
			localStorage.setItem(TRACK_STORAGE_KEY, next.id);
		} catch {
			/* localStorage unavailable */
		}
		if (this.playing) {
			this.loadAndPlayTrack(next);
		}
		this.publishMusicState();
	}

	setMusicVolume(volume: number): void {
		this.musicVolume = THREE.MathUtils.clamp(volume, 0, 1);
		try {
			localStorage.setItem(VOLUME_STORAGE_KEY, this.musicVolume.toFixed(3));
		} catch {
			/* localStorage unavailable */
		}
		if (this.musicGain) {
			this.musicGain.gain.value = this.muted ? 0 : this.musicVolume;
		} else if (this.musicAudio) {
			this.musicAudio.volume = this.muted ? 0 : this.musicVolume;
		}
		if (this.masterGain) {
			this.masterGain.gain.value = this.getSfxGainTarget();
		}
		this.publishMusicState();
	}

	private readStoredTrackId(): string | null {
		try {
			return localStorage.getItem(TRACK_STORAGE_KEY);
		} catch {
			return null;
		}
	}

	private readStoredVolume(): number {
		try {
			const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
			if (raw === null) return DEFAULT_VOLUME;
			const v = parseFloat(raw);
			return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : DEFAULT_VOLUME;
		} catch {
			return DEFAULT_VOLUME;
		}
	}

	private readStoredBestScore(): number {
		try {
			const raw = localStorage.getItem(BEST_SCORE_STORAGE_KEY);
			const v = raw === null ? 0 : parseInt(raw, 10);
			return Number.isFinite(v) && v >= 0 ? v : 0;
		} catch {
			return 0;
		}
	}

	private readStoredBestStageSteps(): number {
		try {
			const raw = localStorage.getItem(BEST_STAGE_STORAGE_KEY);
			const v = raw === null ? 0 : parseInt(raw, 10);
			return Number.isFinite(v) && v >= 0 ? v : 0;
		} catch {
			return 0;
		}
	}

	private writeStoredBestScore(value: number): void {
		try {
			localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(Math.max(0, Math.floor(value))));
		} catch {
			/* localStorage unavailable */
		}
	}

	private writeStoredBestStageSteps(value: number): void {
		try {
			localStorage.setItem(BEST_STAGE_STORAGE_KEY, String(Math.max(0, Math.floor(value))));
		} catch {
			/* localStorage unavailable */
		}
	}

	private playSfx(name: SfxName): void {
		if (this.muted || !this.audioCtx || !this.masterGain) return;
		if (this.audioCtx.state === 'suspended') {
			void this.audioCtx.resume();
		}
		const t0 = this.audioCtx.currentTime;
		switch (name) {
			case 'hit_perfect':
				this.synthBlip(t0, 880, 1320, 0.12, 'triangle', 0.32);
				break;
			case 'hit_nice':
				this.synthBlip(t0, 660, 880, 0.1, 'triangle', 0.26);
				break;
			case 'miss':
				this.synthBlip(t0, 220, 110, 0.14, 'triangle', 0.2);
				break;
			case 'early':
				this.synthBlip(t0, 660, 660, 0.04, 'square', 0.14);
				break;
			case 'combo_milestone':
				this.synthBlip(t0, 880, 880, 0.22, 'sine', 0.18);
				this.synthBlip(t0, 1108, 1108, 0.22, 'sine', 0.14);
				this.synthBlip(t0, 1318, 1318, 0.22, 'sine', 0.12);
				break;
			case 'heart_break':
				if (this.heartBreakBuffer) {
					const src = this.audioCtx.createBufferSource();
					src.buffer = this.heartBreakBuffer;
					src.connect(this.masterGain);
					src.start(t0);
				} else {
					// Fallback while the sample is still loading (or if fetch failed):
					// low body thump + crackle so the break reads as one event.
					this.synthBlip(t0, 180, 70, 0.22, 'sine', 0.22);
					this.synthBlip(t0 + 0.02, 1400, 480, 0.16, 'square', 0.08);
				}
				break;
			case 'intro':
				this.synthBlip(t0, 440, 660, 0.18, 'sine', 0.18);
				this.synthBlip(t0 + 0.08, 660, 880, 0.18, 'sine', 0.16);
				this.synthBlip(t0 + 0.16, 880, 1100, 0.22, 'sine', 0.14);
				break;
		}
	}

	private synthBlip(
		startTime: number,
		freqStart: number,
		freqEnd: number,
		duration: number,
		type: OscillatorType,
		peakGain: number
	): void {
		if (!this.audioCtx || !this.masterGain) return;
		const osc = this.audioCtx.createOscillator();
		const env = this.audioCtx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freqStart, startTime);
		if (freqEnd !== freqStart) {
			osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
		}
		env.gain.setValueAtTime(0.0001, startTime);
		env.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.005);
		env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
		osc.connect(env);
		env.connect(this.masterGain);
		osc.start(startTime);
		osc.stop(startTime + duration + 0.02);
	}

	toggleMute(): void {
		this.muted = !this.muted;
		try {
			localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0');
		} catch {
			/* localStorage unavailable — keep in-memory only */
		}
		if (this.masterGain) {
			this.masterGain.gain.value = this.getSfxGainTarget();
		}
		if (this.musicGain) {
			this.musicGain.gain.value = this.muted ? 0 : this.musicVolume;
		} else if (this.musicAudio) {
			this.musicAudio.volume = this.muted ? 0 : this.musicVolume;
		}
		this.publishMusicState();
	}

	private readMutePreference(): boolean {
		try {
			return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
		} catch {
			return false;
		}
	}

	// The M mute hotkey is handled at the route level (+error.svelte) so it works
	// across all game phases, not just while this listener is attached.
	private onKeyDown = (event: KeyboardEvent): void => {
		if (!this.playing || event.repeat) return;
		const key = event.key.toLowerCase();
		const lane = KEY_TO_LANE.get(key);
		if (lane === undefined) return;
		event.preventDefault();
		this.laneHoldRefcount[lane] += 1;
		this.hitLane(lane, this.getKeySource(event));
	};

	private onKeyUp = (event: KeyboardEvent): void => {
		const key = event.key.toLowerCase();
		const lane = KEY_TO_LANE.get(key);
		if (lane === undefined) return;
		this.laneHoldRefcount[lane] = Math.max(0, this.laneHoldRefcount[lane] - 1);
		if (this.laneHoldRefcount[lane] === 0) this.padNoNote[lane] = false;
		if (!this.playing) return;
		if (this.holding[lane]) {
			event.preventDefault();
			this.releaseHold(lane, this.getKeySource(event));
		}
	};

	private onPointerDown = (event: PointerEvent): void => {
		if (!this.playing) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const lane = this.getPointerLane(event);
		this.pointerLaneById.set(event.pointerId, lane);
		this.laneHoldRefcount[lane] += 1;
		event.preventDefault();
		this.hitLane(lane, this.getPointerSource(event.pointerId));
	};

	private onPointerRelease = (event: PointerEvent): void => {
		const lane = this.pointerLaneById.get(event.pointerId);
		if (lane === undefined) return;
		this.pointerLaneById.delete(event.pointerId);
		this.laneHoldRefcount[lane] = Math.max(0, this.laneHoldRefcount[lane] - 1);
		if (this.laneHoldRefcount[lane] === 0) this.padNoNote[lane] = false;
		if (!this.playing) return;
		event.preventDefault();
		this.releaseHold(lane, this.getPointerSource(event.pointerId));
	};

	private onWindowBlur = (): void => {
		this.laneHoldRefcount.fill(0);
		this.padNoNote.fill(false);
		if (!this.playing) return;
		this.pointerLaneById.clear();
		for (let lane = 0; lane < LANE_COUNT; lane++) {
			if (this.holding[lane]) this.breakHold(lane);
		}
	};

	private getKeySource(event: KeyboardEvent): InputSource {
		return `key:${event.code || event.key.toLowerCase()}` as InputSource;
	}

	private getPointerSource(pointerId: number): InputSource {
		return `pointer:${pointerId}`;
	}

	private getPointerLane(event: PointerEvent): number {
		this.projectPadScreens();
		const padCenterY =
			this.padScreenY.reduce((sum, y) => sum + y, 0) / Math.max(1, this.padScreenY.length);
		const nearPads = Math.abs(event.clientY - padCenterY) < Math.max(110, window.innerHeight * 0.2);
		const yWeight = nearPads ? 0.18 : 0.04;
		let lane = 0;
		let bestDistance = Infinity;

		for (let i = 0; i < LANE_COUNT; i++) {
			const distance =
				Math.abs(event.clientX - this.padScreenX[i]) +
				Math.abs(event.clientY - this.padScreenY[i]) * yWeight;
			if (distance < bestDistance) {
				bestDistance = distance;
				lane = i;
			}
		}

		return lane;
	}
}
