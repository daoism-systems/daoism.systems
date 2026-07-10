import * as THREE from 'three';

export interface ParticleGeneratorOptions {
	count: number;
	distribution?: 'surface' | 'volume' | 'edges' | 'uniform';
	scale?: THREE.Vector3;
	seed?: number;
	volumeThreshold?: number; // For better volume detection
	surfaceOffset?: number; // Offset from surface for volume particles
}

/**
 * Generate particles on shape
 * @param sourceGeometry The original font geometry to sample the shape from
 * @param options Configuration for particle generation
 * @returns A new BufferGeometry with the specified number of particles
 */
export function generateParticles(
	sourceGeometry: THREE.BufferGeometry,
	options: ParticleGeneratorOptions
): THREE.BufferGeometry {
	const {
		count = 1000,
		distribution = 'volume',
		scale = new THREE.Vector3(1, 1, 1),
		seed = Math.random(),
		volumeThreshold = 0.1,
		surfaceOffset = 0.05
	} = options;

	// Create array to hold particle positions
	const positions = new Float32Array(count * 3);

	// Get bounding box of the source geometry
	sourceGeometry.computeBoundingBox();
	const bbox = sourceGeometry.boundingBox!;

	// Better random number generator (LCG with larger period)
	const random = createBetterRandom(seed);

	switch (distribution) {
		case 'surface':
			generateSurfaceParticles(sourceGeometry, positions, count, scale, random);
			break;
		case 'volume':
			generateVolumeParticles(
				sourceGeometry,
				positions,
				count,
				scale,
				random,
				volumeThreshold,
				surfaceOffset
			);
			break;
		case 'edges':
			generateEdgeParticles(sourceGeometry, positions, count, scale, random);
			break;
		case 'uniform':
			generateUniformParticles(sourceGeometry, positions, count, scale, random, volumeThreshold);
			break;
	}

	// Create new geometry with the particle positions
	const particleGeometry = new THREE.BufferGeometry();
	particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	// Generate normals pointing away from the nearest surface
	const normals = new Float32Array(count * 3);
	const tempVector = new THREE.Vector3();
	const center = new THREE.Vector3();
	bbox.getCenter(center);

	for (let i = 0; i < count; i++) {
		tempVector.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

		// Calculate normal as direction from center (simple approximation)
		tempVector.sub(center).normalize();

		normals[i * 3] = tempVector.x;
		normals[i * 3 + 1] = tempVector.y;
		normals[i * 3 + 2] = tempVector.z;
	}
	particleGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

	return particleGeometry;
}

/**
 * Generate particles on the surface of the mesh using proper triangle sampling
 */
function generateSurfaceParticles(
	geometry: THREE.BufferGeometry,
	positions: Float32Array,
	count: number,
	scale: THREE.Vector3,
	random: () => number
): void {
	const tempGeometry = geometry.clone();
	tempGeometry.scale(scale.x, scale.y, scale.z);

	// Ensure we have a non-indexed geometry for triangle sampling
	const nonIndexedGeometry = tempGeometry.index ? tempGeometry.toNonIndexed() : tempGeometry;
	const positionAttribute = nonIndexedGeometry.getAttribute('position');

	if (!positionAttribute) {
		console.error('Geometry has no position attribute');
		return;
	}

	const triangleCount = positionAttribute.count / 3;
	const triangleAreas: number[] = [];
	let totalArea = 0;

	// Calculate triangle areas for weighted sampling
	for (let i = 0; i < triangleCount; i++) {
		const i3 = i * 3;
		const v1 = new THREE.Vector3(
			positionAttribute.getX(i3),
			positionAttribute.getY(i3),
			positionAttribute.getZ(i3)
		);
		const v2 = new THREE.Vector3(
			positionAttribute.getX(i3 + 1),
			positionAttribute.getY(i3 + 1),
			positionAttribute.getZ(i3 + 1)
		);
		const v3 = new THREE.Vector3(
			positionAttribute.getX(i3 + 2),
			positionAttribute.getY(i3 + 2),
			positionAttribute.getZ(i3 + 2)
		);

		// Calculate triangle area
		const edge1 = new THREE.Vector3().subVectors(v2, v1);
		const edge2 = new THREE.Vector3().subVectors(v3, v1);
		const area = edge1.cross(edge2).length() * 0.5;

		triangleAreas.push(area);
		totalArea += area;
	}

	// Create cumulative distribution for area-weighted sampling
	const cumulativeAreas: number[] = [];
	let cumSum = 0;
	for (let i = 0; i < triangleAreas.length; i++) {
		cumSum += triangleAreas[i] / totalArea;
		cumulativeAreas.push(cumSum);
	}

	// Generate particles
	for (let i = 0; i < count; i++) {
		// Select triangle based on area
		const r = random();
		let triangleIndex = 0;
		for (let j = 0; j < cumulativeAreas.length; j++) {
			if (r <= cumulativeAreas[j]) {
				triangleIndex = j;
				break;
			}
		}

		const i3 = triangleIndex * 3;
		const v1 = new THREE.Vector3(
			positionAttribute.getX(i3),
			positionAttribute.getY(i3),
			positionAttribute.getZ(i3)
		);
		const v2 = new THREE.Vector3(
			positionAttribute.getX(i3 + 1),
			positionAttribute.getY(i3 + 1),
			positionAttribute.getZ(i3 + 1)
		);
		const v3 = new THREE.Vector3(
			positionAttribute.getX(i3 + 2),
			positionAttribute.getY(i3 + 2),
			positionAttribute.getZ(i3 + 2)
		);

		// Generate random point on triangle using barycentric coordinates
		let u = random();
		let v = random();

		if (u + v > 1) {
			u = 1 - u;
			v = 1 - v;
		}

		const w = 1 - u - v;

		const point = new THREE.Vector3()
			.addScaledVector(v1, u)
			.addScaledVector(v2, v)
			.addScaledVector(v3, w);

		positions[i * 3] = point.x;
		positions[i * 3 + 1] = point.y;
		positions[i * 3 + 2] = point.z;
	}
}

/**
 * Generate particles within the volume using ray casting for accurate inside/outside testing
 */
function generateVolumeParticles(
	geometry: THREE.BufferGeometry,
	positions: Float32Array,
	count: number,
	scale: THREE.Vector3,
	random: () => number,
	volumeThreshold: number,
	surfaceOffset: number
): void {
	const tempGeometry = geometry.clone();
	tempGeometry.scale(scale.x, scale.y, scale.z);

	// Create a mesh for ray casting
	const mesh = new THREE.Mesh(tempGeometry);
	const raycaster = new THREE.Raycaster();

	const bbox =
		tempGeometry.boundingBox ||
		new THREE.Box3().setFromBufferAttribute(tempGeometry.getAttribute('position'));
	const min = bbox.min;
	const max = bbox.max;
	const size = new THREE.Vector3().subVectors(max, min);

	let generatedCount = 0;
	let attempts = 0;
	const maxAttempts = count * 10; // Prevent infinite loops

	while (generatedCount < count && attempts < maxAttempts) {
		attempts++;

		// Generate random point in bounding box
		const x = min.x + random() * size.x;
		const y = min.y + random() * size.y;
		const z = min.z + random() * size.z;

		const point = new THREE.Vector3(x, y, z);

		// Test if point is inside the geometry using ray casting
		if (isPointInsideGeometry(point, mesh, raycaster)) {
			// Add some offset from surface for visual effect
			const surfacePoint = findNearestSurfacePoint(point, mesh, raycaster);
			const direction = new THREE.Vector3().subVectors(point, surfacePoint).normalize();
			point.add(direction.multiplyScalar(surfaceOffset));

			positions[generatedCount * 3] = point.x;
			positions[generatedCount * 3 + 1] = point.y;
			positions[generatedCount * 3 + 2] = point.z;
			generatedCount++;
		}
	}

	// If we couldn't generate enough particles, fill the rest with surface particles
	if (generatedCount < count) {
		const remainingPositions = positions.subarray(generatedCount * 3);
		generateSurfaceParticles(geometry, remainingPositions, count - generatedCount, scale, random);
	}
}

/**
 * Test if a point is inside geometry using ray casting
 */
function isPointInsideGeometry(
	point: THREE.Vector3,
	mesh: THREE.Mesh,
	raycaster: THREE.Raycaster
): boolean {
	// Cast rays in multiple directions and count intersections
	const directions = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(-1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, -1, 0),
		new THREE.Vector3(0, 0, 1),
		new THREE.Vector3(0, 0, -1)
	];

	let insideCount = 0;

	for (const direction of directions) {
		raycaster.set(point, direction);
		const intersections = raycaster.intersectObject(mesh);

		// If odd number of intersections, point is inside
		if (intersections.length % 2 === 1) {
			insideCount++;
		}
	}

	// Point is inside if majority of rays indicate it's inside
	return insideCount > directions.length / 2;
}

/**
 * Find nearest surface point (simplified approximation)
 */
function findNearestSurfacePoint(
	point: THREE.Vector3,
	mesh: THREE.Mesh,
	raycaster: THREE.Raycaster
): THREE.Vector3 {
	const directions = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(-1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, -1, 0),
		new THREE.Vector3(0, 0, 1),
		new THREE.Vector3(0, 0, -1)
	];

	let closestPoint = point.clone();
	let minDistance = Infinity;

	for (const direction of directions) {
		raycaster.set(point, direction);
		const intersections = raycaster.intersectObject(mesh);

		if (intersections.length > 0) {
			const distance = point.distanceTo(intersections[0].point);
			if (distance < minDistance) {
				minDistance = distance;
				closestPoint = intersections[0].point;
			}
		}
	}

	return closestPoint;
}

/**
 * Generate particles along the edges with better distribution
 */
function generateEdgeParticles(
	geometry: THREE.BufferGeometry,
	positions: Float32Array,
	count: number,
	scale: THREE.Vector3,
	random: () => number
): void {
	const tempGeometry = geometry.clone();
	tempGeometry.scale(scale.x, scale.y, scale.z);

	const edges = new THREE.EdgesGeometry(tempGeometry);
	const edgePositions = edges.getAttribute('position');
	const edgeCount = edgePositions.count / 2;

	// Calculate edge lengths for weighted sampling
	const edgeLengths: number[] = [];
	let totalLength = 0;

	for (let i = 0; i < edgeCount; i++) {
		const i2 = i * 2;
		const v1 = new THREE.Vector3(
			edgePositions.getX(i2),
			edgePositions.getY(i2),
			edgePositions.getZ(i2)
		);
		const v2 = new THREE.Vector3(
			edgePositions.getX(i2 + 1),
			edgePositions.getY(i2 + 1),
			edgePositions.getZ(i2 + 1)
		);

		const length = v1.distanceTo(v2);
		edgeLengths.push(length);
		totalLength += length;
	}

	// Create cumulative distribution
	const cumulativeLengths: number[] = [];
	let cumSum = 0;
	for (let i = 0; i < edgeLengths.length; i++) {
		cumSum += edgeLengths[i] / totalLength;
		cumulativeLengths.push(cumSum);
	}

	for (let i = 0; i < count; i++) {
		// Select edge based on length
		const r = random();
		let edgeIndex = 0;
		for (let j = 0; j < cumulativeLengths.length; j++) {
			if (r <= cumulativeLengths[j]) {
				edgeIndex = j;
				break;
			}
		}

		const i2 = edgeIndex * 2;
		const v1 = new THREE.Vector3(
			edgePositions.getX(i2),
			edgePositions.getY(i2),
			edgePositions.getZ(i2)
		);
		const v2 = new THREE.Vector3(
			edgePositions.getX(i2 + 1),
			edgePositions.getY(i2 + 1),
			edgePositions.getZ(i2 + 1)
		);

		// Interpolate along edge
		const t = random();
		const point = new THREE.Vector3().lerpVectors(v1, v2, t);

		positions[i * 3] = point.x;
		positions[i * 3 + 1] = point.y;
		positions[i * 3 + 2] = point.z;
	}
}

/**
 * Generate uniformly distributed particles using better spatial distribution
 */
function generateUniformParticles(
	geometry: THREE.BufferGeometry,
	positions: Float32Array,
	count: number,
	scale: THREE.Vector3,
	random: () => number,
	volumeThreshold: number
): void {
	const tempGeometry = geometry.clone();
	tempGeometry.scale(scale.x, scale.y, scale.z);

	const mesh = new THREE.Mesh(tempGeometry);
	const raycaster = new THREE.Raycaster();

	const bbox =
		tempGeometry.boundingBox ||
		new THREE.Box3().setFromBufferAttribute(tempGeometry.getAttribute('position'));
	const min = bbox.min;
	const max = bbox.max;
	const size = new THREE.Vector3().subVectors(max, min);

	// Use Poisson disk sampling for better uniform distribution
	const minDistance = Math.pow((size.x * size.y * size.z) / count, 1 / 3) * 0.8;
	const points: THREE.Vector3[] = [];
	const candidates: THREE.Vector3[] = [];

	// Start with a random point inside the geometry
	let attempts = 0;
	while (candidates.length === 0 && attempts < 1000) {
		const x = min.x + random() * size.x;
		const y = min.y + random() * size.y;
		const z = min.z + random() * size.z;
		const point = new THREE.Vector3(x, y, z);

		if (isPointInsideGeometry(point, mesh, raycaster)) {
			candidates.push(point);
		}
		attempts++;
	}

	while (points.length < count && candidates.length > 0) {
		const candidateIndex = Math.floor(random() * candidates.length);
		const candidate = candidates[candidateIndex];
		candidates.splice(candidateIndex, 1);

		// Check if candidate is far enough from existing points
		let valid = true;
		for (const existingPoint of points) {
			if (candidate.distanceTo(existingPoint) < minDistance) {
				valid = false;
				break;
			}
		}

		if (valid) {
			points.push(candidate);

			// Generate new candidates around this point
			for (let i = 0; i < 8; i++) {
				const angle1 = random() * Math.PI * 2;
				const angle2 = random() * Math.PI * 2;
				const distance = minDistance * (1 + random());

				const newPoint = new THREE.Vector3(
					candidate.x + Math.cos(angle1) * Math.sin(angle2) * distance,
					candidate.y + Math.sin(angle1) * Math.sin(angle2) * distance,
					candidate.z + Math.cos(angle2) * distance
				);

				if (isPointInsideGeometry(newPoint, mesh, raycaster)) {
					candidates.push(newPoint);
				}
			}
		}
	}

	// Fill positions array
	for (let i = 0; i < Math.min(count, points.length); i++) {
		positions[i * 3] = points[i].x;
		positions[i * 3 + 1] = points[i].y;
		positions[i * 3 + 2] = points[i].z;
	}

	// Fill remaining with random volume particles if needed
	if (points.length < count) {
		const remainingPositions = positions.subarray(points.length * 3);
		generateVolumeParticles(
			geometry,
			remainingPositions,
			count - points.length,
			scale,
			random,
			volumeThreshold,
			0
		);
	}
}

/**
 * Better random number generator using Linear Congruential Generator
 */
function createBetterRandom(seed: number): () => number {
	let state = Math.floor(Math.abs(seed * 2147483647)) % 2147483647;
	if (state <= 0) state += 2147483646;

	return (): number => {
		state = (state * 16807) % 2147483647;
		return (state - 1) / 2147483646;
	};
}
