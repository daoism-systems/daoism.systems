/**
 * Optimize DAO_mobile_scene.glb after the Blender export (gltf-transform).
 *
 * The Blender export force-samples every action at 60 fps (2801 keys per
 * curve), so animation dominates the file (~7 MB of ~9.5 MB). This pass:
 *
 *   - resample(): drops keyframes that lie on the interpolated line between
 *     their neighbors — the mobile animation is simple, so parked objects
 *     collapse to a handful of keys (median ~6 per sampler).
 *   - dedup(): shares identical mesh data between the many duplicated
 *     cube/glass pyramid objects (206 meshes -> ~38 unique).
 *   - prune(): removes anything orphaned by the above.
 *   - single Draco re-encode with the same quantization as the Blender
 *     scripts (position 14 / normal 10 / texcoord 12).
 *
 * Everything runs in ONE read -> ONE write, so meshes go through exactly one
 * lossy Draco decode/encode cycle. Node names and per-clip durations are
 * untouched — every clip must stay 46.68 s (see convert_fbx_to_glb_mobile.py).
 *
 * Usage (after `blender --background --python scripts/convert_fbx_to_glb_mobile.py`):
 *   node scripts/optimize_mobile_scene.mjs
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { resample, dedup, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { statSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = new URL('..', import.meta.url).pathname;
const GLB_INPUT = join(PROJECT_DIR, 'static/models/DAO_mobile_scene.glb');
const GLB_OUTPUT = join(PROJECT_DIR, 'static/models/DAO_mobile_scene.glb');

async function main() {
	console.log('='.repeat(60));
	console.log('Optimize DAO_mobile_scene.glb (resample + dedup + draco)');
	console.log('='.repeat(60));

	const originalSize = statSync(GLB_INPUT).size;
	console.log(`Input: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

	const io = new NodeIO()
		.registerExtensions([KHRDracoMeshCompression])
		.registerDependencies({
			'draco3d.decoder': await draco3d.createDecoderModule(),
			'draco3d.encoder': await draco3d.createEncoderModule()
		});

	const document = await io.read(GLB_INPUT);

	const root = document.getRoot();
	const clipCount = root.listAnimations().length;
	const meshCountBefore = root.listMeshes().length;

	// keepLeaves: the Sign/Sign_02/Sign_03 empties are leaf nodes with nothing
	// attached, but resolveSceneModelObjects looks them up as annotation anchors.
	await document.transform(resample(), dedup(), prune({ keepLeaves: true }));

	document
		.createExtension(KHRDracoMeshCompression)
		.setRequired(true)
		.setEncoderOptions({
			method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
			quantizationBits: {
				POSITION: 14,
				NORMAL: 10,
				TEX_COORD: 12
			}
		});

	await io.write(GLB_OUTPUT, document);

	const newSize = statSync(GLB_OUTPUT).size;
	console.log(`Meshes: ${meshCountBefore} -> ${root.listMeshes().length} unique`);
	console.log(`Clips: ${clipCount} (must be unchanged)`);
	console.log(
		`Output: ${(newSize / 1024 / 1024).toFixed(2)} MB ` +
			`(${((1 - newSize / originalSize) * 100).toFixed(0)}% smaller)`
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
