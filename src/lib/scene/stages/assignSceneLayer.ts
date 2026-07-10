import type * as THREE from 'three/webgpu';

/**
 * Recursively put every descendant of `root` on the given layer channel,
 * preserving any auxiliary channels they may already have (chromatic,
 * train-slider). Default channel 0 is removed so the object can no
 * longer leak into a different scene's pass via the empty/default layer.
 */
export function assignSceneLayer(root: THREE.Object3D | null, channel: number): void {
	if (!root) return;
	root.traverse((obj) => {
		obj.layers.disable(0);
		obj.layers.enable(channel);
	});
}
