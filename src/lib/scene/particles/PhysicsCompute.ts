import * as THREE from 'three';
import type { StorageBufferNode, UniformNode } from 'three/webgpu';
import {
	vec3,
	vec4,
	Fn,
	If,
	time,
	uniform,
	float,
	clamp,
	deltaTime,
	instanceIndex,
	length,
	min,
	mix,
	mx_noise_vec3,
	pow,
	smoothstep
} from 'three/tsl';
import type { VelocityNode } from './FluidMouseField';

type FloatUniform = UniformNode<'float', number>;
type Matrix4Uniform = UniformNode<'mat4', THREE.Matrix4>;
type Vector3Uniform = UniformNode<'vec3', THREE.Vector3>;

/**
 * Tunable uniforms exposed by the octagon fluid simulation.
 * Each system owns its own copies — adjust per-instance, expose via inspector.
 */
export interface OctagonFluidUniforms {
	/** 0..1 interaction envelope (CPU-side). Master switch for whether the compute
	 * runs at all and when CPU-pin re-engages. Also read by the kernel as a hard
	 * ceiling on per-particle wake: the fluid texture is only a GPU-side estimate
	 * that has held stale energy before (idle-skip freeze), so "no recent input"
	 * must always win over whatever the field says. */
	uActivity: FloatUniform;
	uMouseForce: FloatUniform;
	uCurlStrength: FloatUniform;
	uCurlScale: FloatUniform;
	uCurlTimeSpeed: FloatUniform;
	uOriginSpring: FloatUniform;
	uModelAttraction: FloatUniform;
	uModelFalloffEdge: FloatUniform;
	uDamping: FloatUniform;
	uSpeedSmoothing: FloatUniform;
	uMouseDampScale: FloatUniform;
	uMouseDampMax: FloatUniform;
	/** Local-wake thresholds. Per-particle activity = smoothstep(floor, full, |localFluidVel|),
	 * replacing the old global activity gate so only particles with real fluid energy under
	 * them animate. `floor` is a deadzone that ignores residual/advected-spillover velocity;
	 * raise both together if the field reads hotter than expected. */
	uActivityFloor: FloatUniform;
	uActivityFull: FloatUniform;
}

/**
 * Camera-derived uniforms used to project particle world positions to screen-space
 * for sampling the FluidMouseField velocity texture. Updated each frame by the system.
 */
export interface CameraProjectionUniforms {
	uProjMatrix: Matrix4Uniform;
	uViewMatrix: Matrix4Uniform;
	uCamRight: Vector3Uniform;
	uCamUp: Vector3Uniform;
}

export interface OctagonFluidComputeOptions {
	worldPositions: StorageBufferNode<'vec3'>;
	velocities: StorageBufferNode<'vec4'>;
	origins: StorageBufferNode<'vec3'>;
	localPositions: StorageBufferNode<'vec3'>;
	transformMatrix: Matrix4Uniform;
	mouseVelocityNode: VelocityNode;
	camera: CameraProjectionUniforms;
	uniforms: OctagonFluidUniforms;
	particleCount: number;
}

export function createOctagonFluidUniforms(): OctagonFluidUniforms {
	return {
		uActivity: uniform(0),
		// The shared FluidMouseField is tuned for the post-process display whose
		// velocity values reach ~hundreds (matching VFX-JS's `splatForce: 3000`).
		// Particles read the same field, so this multiplier is small to keep
		// them from being flung. Tunable in the Octagon inspector's "Fluid Sim"
		// folder if a different feel is wanted.
		uMouseForce: uniform(0.6),
		uCurlStrength: uniform(0.168),
		uCurlScale: uniform(10.5),
		uCurlTimeSpeed: uniform(3),
		uOriginSpring: uniform(5.0),
		uModelAttraction: uniform(0.2),
		uModelFalloffEdge: uniform(0.03),
		uDamping: uniform(0.9),
		uSpeedSmoothing: uniform(0.035),
		uMouseDampScale: uniform(0.65),
		uMouseDampMax: uniform(1.0),
		// Fluid speed at which a particle is fully "awake". The field reads ~O(1) during
		// real on-cloud interaction (cf. uMouseDampScale), so floor 0.1 → full 1.0 keeps
		// the cloud still under faint/off-cloud field energy and blooms it under the pointer.
		uActivityFloor: uniform(0.1),
		uActivityFull: uniform(1.0)
	};
}

export function createCameraProjectionUniforms(): CameraProjectionUniforms {
	return {
		uProjMatrix: uniform(new THREE.Matrix4()),
		uViewMatrix: uniform(new THREE.Matrix4()),
		uCamRight: uniform(new THREE.Vector3(1, 0, 0)),
		uCamUp: uniform(new THREE.Vector3(0, 1, 0))
	};
}

/**
 * Build the per-frame fused velocity+position update kernel for the octagon fluid sim.
 *
 * Per particle:
 *  0. Project world position to screen UV and sample the FluidMouseField. The local
 *     fluid speed (smoothstep deadzone) becomes this particle's activity — the gate
 *     deciding whether it animates. No local fluid → it stays pinned to the shape.
 *  1. Curl noise, scaled by local activity (only disturbed particles swirl).
 *  2. Screen-space fluid displacement, scaled by local activity.
 *  3. Origin spring toward `transformMatrix * origin` (scatter), scaled by local activity.
 *  4. Model attraction toward `transformMatrix * localPos` (vertex shape) — NOT gated;
 *     the restoring force that returns a bloomed particle to the shape.
 *  5. Damping + speed smoothing into vel.w.
 *  6. Integrate position.
 *
 * Targets are computed on the GPU each frame from the uniform `transformMatrix` —
 * no per-frame storage buffer uploads (Safari WebGPU compatible).
 */
export function createOctagonFluidPhysicsCompute(options: OctagonFluidComputeOptions) {
	const {
		worldPositions,
		velocities,
		origins,
		localPositions,
		transformMatrix,
		mouseVelocityNode,
		camera,
		uniforms,
		particleCount
	} = options;

	const {
		uActivity,
		uMouseForce,
		uCurlStrength,
		uCurlScale,
		uCurlTimeSpeed,
		uOriginSpring,
		uModelAttraction,
		uModelFalloffEdge,
		uDamping,
		uSpeedSmoothing,
		uMouseDampScale,
		uMouseDampMax,
		uActivityFloor,
		uActivityFull
	} = uniforms;

	const { uProjMatrix, uViewMatrix, uCamRight, uCamUp } = camera;

	return Fn(() => {
		const idx = instanceIndex;
		const pos = worldPositions.element(idx);
		const vel = velocities.element(idx).toVar();

		// TSL `deltaTime` is raw wall-clock between renders (NodeFrame.update) — a
		// tab switch, GPU hitch or long GC pause hands us a multi-second value that
		// the displacement term below turns into a world-unit teleport. Ceiling
		// matches FluidMouseField.step(), which clamps for the same reason.
		const dt = min(deltaTime, float(1 / 30)).toVar();

		// 0. Project world position → screen UV and sample the shared FluidMouseField
		// FIRST, so this particle's "wake" is driven by the fluid energy actually present
		// under it. Off-cloud pointer motion splats elsewhere and leaves ~0 velocity here,
		// so those particles stay pinned to the shape; only the ones the pointer drags
		// through wake. Replaces the old global uActivity gate (whole-cloud bloom).
		const clip = uProjMatrix.mul(uViewMatrix).mul(vec4(pos, 1));
		const ndc = clip.xy.div(clip.w);
		const screenUV = ndc.add(1).mul(0.5);

		const inBounds = screenUV.x
			.greaterThanEqual(0)
			.and(screenUV.x.lessThanEqual(1))
			.and(screenUV.y.greaterThanEqual(0))
			.and(screenUV.y.lessThanEqual(1));

		// CPU interaction envelope as a hard ceiling on wake. The field texture is
		// only an estimate of "fluid under this particle" — it can hold stale or
		// self-sustained energy (vorticity confinement re-injects some each step) —
		// while uActivity is the authoritative "user actually interacted lately"
		// (boosted on input, 0.65s half-life decay). Requiring BOTH means leftover
		// texture energy can never hold the cloud open on its own: ~3s after the
		// last input the envelope forces activity to 0 and the ungated model
		// attraction below closes the shape, whatever the field says.
		const inputEnvelope = smoothstep(float(0), float(0.05), uActivity);

		const mouseVel = vec4(0).toVar();
		const localActivity = float(0).toVar();
		If(inBounds, () => {
			mouseVel.assign(mouseVelocityNode.sample(screenUV));
			// Per-particle activity from local fluid speed. The deadzone (uActivityFloor)
			// ignores residual/advected-spillover velocity so idle particles stay put.
			localActivity.assign(
				smoothstep(uActivityFloor, uActivityFull, length(mouseVel.xy)).mul(inputEnvelope)
			);
		});

		// 1. Curl-ish noise drift, gated by LOCAL activity so the cloud only swirls
		// where it is actually being disturbed (no whole-cloud "crunch").
		const noiseCoord = pos.mul(uCurlScale).add(vec3(time.mul(uCurlTimeSpeed)));
		vel.xyz.addAssign(mx_noise_vec3(noiseCoord).mul(uCurlStrength).mul(localActivity));

		// 2. Mouse fluid displacement (screen-space), gated by local activity. mouseVel is
		// 0 when out of bounds, so this is a no-op for off-screen particles.
		const displacement = uCamRight.mul(mouseVel.x).add(uCamUp.mul(mouseVel.y));
		vel.xyz.addAssign(displacement.mul(dt).mul(uMouseForce).mul(localActivity));

		const mouseDampening = float(1).sub(
			clamp(length(mouseVel.xy).mul(uMouseDampScale), 0, uMouseDampMax)
		);
		const activeMouseDampening = mix(float(1), mouseDampening, localActivity);

		// 3. Origin spring (pull toward scattered rest pose, which itself moves with the
		// source mesh). Gated by local activity so only disturbed particles bloom off the
		// crisp shape; the rest never leave it.
		const originLocal = origins.element(idx);
		const originWorld = transformMatrix.mul(vec4(originLocal, 1)).xyz;
		vel.xyz.addAssign(
			originWorld
				.sub(pos)
				.mul(dt)
				.mul(uOriginSpring)
				.mul(localActivity)
				.mul(activeMouseDampening)
		);

		// 4. Model attraction (distance-scaled spring toward the animated vertex shape).
		// Intentionally NOT activity-gated — this is the restoring force that returns a
		// bloomed particle to the shape once the local fluid decays.
		const modelLocal = localPositions.element(idx);
		const modelWorld = transformMatrix.mul(vec4(modelLocal, 1)).xyz;
		const toModel = modelWorld.sub(pos);
		const dist = length(toModel);
		const falloff = smoothstep(0, uModelFalloffEdge, dist);
		vel.xyz.addAssign(
			toModel.mul(dt.mul(60)).mul(falloff).mul(uModelAttraction).mul(activeMouseDampening)
		);

		// 5. Damping + speed smoothing
		vel.xyz.mulAssign(pow(uDamping, dt.mul(60)));
		vel.w.assign(mix(vel.w, length(vel.xyz), uSpeedSmoothing));

		velocities.element(idx).assign(vel);

		// 6. Integrate position (no Y/XZ clamps — the octagon roams freely with the camera animation)
		pos.addAssign(vel.xyz.mul(dt));
	})().compute(particleCount);
}
