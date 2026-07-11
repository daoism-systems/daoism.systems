import * as THREE from 'three/webgpu';

const UNIT_QUAD_KEY = '__sharedUnitQuad';
let unitQuad: THREE.PlaneGeometry | null = null;
let unitQuadRefCount = 0;

function markShared(geometry: THREE.BufferGeometry, key: string): void {
	geometry.userData.sharedGeometryKey = key;
}

export function acquireUnitQuadGeometry(): THREE.PlaneGeometry {
	if (!unitQuad) {
		unitQuad = new THREE.PlaneGeometry(1, 1);
		markShared(unitQuad, UNIT_QUAD_KEY);
	}

	unitQuadRefCount += 1;
	return unitQuad;
}

export function releaseSharedGeometry(geometry: THREE.BufferGeometry | null | undefined): boolean {
	if (!geometry) return false;
	const key = geometry.userData?.sharedGeometryKey;

	if (key !== UNIT_QUAD_KEY || !unitQuad || geometry !== unitQuad) {
		return false;
	}

	unitQuadRefCount = Math.max(0, unitQuadRefCount - 1);
	if (unitQuadRefCount === 0) {
		unitQuad.dispose();
		unitQuad = null;
	}

	return true;
}
