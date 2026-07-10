/**
 * Strip Pyramid Base Meshes from DAO_full_scene.glb using gltf-transform.
 *
 * Surgically removes pyramid base nodes and their animation channels
 * WITHOUT re-encoding meshes or altering other data. This preserves
 * the original Draco compression, animation interpolation, and all
 * non-pyramid content exactly as-is.
 *
 * What is PRESERVED:
 *   - Pyramid root group node (visibility toggling)
 *   - Particle / _remesh source meshes + their animation channels
 *   - All parent empty nodes (particle meshes inherit their transforms)
 *   - Everything non-pyramid (Octagon, Sausages, Forest, Signs, Camera, etc.)
 *
 * Usage:
 *   node scripts/strip_pyramid_bases.mjs
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = new URL('..', import.meta.url).pathname;
const GLB_INPUT = join(PROJECT_DIR, 'static/models/DAO_full_scene.glb');
const GLB_OUTPUT = join(PROJECT_DIR, 'static/models/DAO_full_scene.glb');
const PYRAMID_ROOT_CANDIDATES = ['pyramids_1', 'Pyramids'];

/**
 * Check if a node is a pyramid base mesh (not particle/remesh).
 * Mirrors the logic in bake_pyramid_vat.py: get_pyramid_base_meshes().
 */
function isPyramidBaseMesh(node) {
	const name = (node.getName() || '').toLowerCase();
	// Skip particle and remesh nodes — these drive particle systems
	if (name.includes('particle') || name.includes('_remesh')) {
		return false;
	}
	// It's a base mesh if it has a mesh attached
	return node.getMesh() !== null;
}

/**
 * Recursively collect pyramid base mesh nodes under a root.
 */
function collectBaseMeshes(node, result = []) {
	const name = (node.getName() || '').toLowerCase();
	// Skip entire particle/remesh subtrees
	if (name.includes('particle') || name.includes('_remesh')) {
		return result;
	}
	if (node.getMesh()) {
		result.push(node);
	}
	for (const child of node.listChildren()) {
		collectBaseMeshes(child, result);
	}
	return result;
}

async function main() {
	console.log('='.repeat(60));
	console.log('Strip Pyramid Base Meshes from DAO_full_scene.glb (gltf-transform)');
	console.log('='.repeat(60));

	const originalSize = statSync(GLB_INPUT).size;
	console.log(`Original file size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

	// Set up IO with Draco support to read the file
	const io = new NodeIO()
		.registerExtensions([KHRDracoMeshCompression])
		.registerDependencies({
			'draco3d.decoder': await draco3d.createDecoderModule(),
			'draco3d.encoder': await draco3d.createEncoderModule(),
		});

	console.log('\nReading GLB...');
	const document = await io.read(GLB_INPUT);
	const root = document.getRoot();

	// Find pyramid root node (legacy/new schemas)
	const allNodes = root.listNodes();
	const pyramidRoot = allNodes.find(n => {
		const name = n.getName() || '';
		return PYRAMID_ROOT_CANDIDATES.some(candidate => name === candidate || name.startsWith(candidate + '.'));
	});

	const fallbackRoot = pyramidRoot || allNodes.find(n => (n.getName() || '').toLowerCase().includes('pyramid'));
	if (!fallbackRoot) {
		console.error(`ERROR: Pyramid root not found! Tried [${PYRAMID_ROOT_CANDIDATES.join(', ')}] and name contains 'pyramid'.`);
		const nodeNames = allNodes.map(n => n.getName()).filter(Boolean).slice(0, 40);
		console.error('Available nodes (first 40):', nodeNames);
		process.exit(1);
	}

	console.log(`Found root: ${fallbackRoot.getName()}`);

	// Collect base mesh nodes to remove
	const baseMeshNodes = collectBaseMeshes(fallbackRoot);
	console.log(`\nFound ${baseMeshNodes.length} pyramid base mesh nodes to remove`);

	if (baseMeshNodes.length === 0) {
		console.log('Nothing to strip — exiting.');
		return;
	}

	console.log(`  First 5: ${baseMeshNodes.slice(0, 5).map(n => n.getName())}`);
	console.log(`  Last 5: ${baseMeshNodes.slice(-5).map(n => n.getName())}`);

	const baseMeshNodeSet = new Set(baseMeshNodes);
	const baseMeshNames = new Set(baseMeshNodes.map(n => n.getName()));

	// Count animation channels before
	const animations = root.listAnimations();
	const channelsBefore = animations.reduce((sum, a) => sum + a.listChannels().length, 0);
	console.log(`\nAnimation channels before: ${channelsBefore}`);

	// Remove animation channels targeting base mesh nodes
	let removedChannels = 0;
	for (const animation of animations) {
		for (const channel of animation.listChannels()) {
			const targetNode = channel.getTargetNode();
			if (targetNode && baseMeshNodeSet.has(targetNode)) {
				channel.dispose();
				removedChannels++;
			}
		}
	}
	console.log(`Removed ${removedChannels} animation channels`);

	// Collect meshes that will become orphaned (only used by base mesh nodes)
	const meshesToCheck = new Set();
	for (const node of baseMeshNodes) {
		const mesh = node.getMesh();
		if (mesh) meshesToCheck.add(mesh);
	}

	// Remove the base mesh nodes (detach from parent)
	let removedNodes = 0;
	for (const node of baseMeshNodes) {
		node.dispose();
		removedNodes++;
	}
	console.log(`Removed ${removedNodes} nodes`);

	// Clean up orphaned meshes (meshes with no remaining node references)
	let removedMeshes = 0;
	for (const mesh of meshesToCheck) {
		// After disposing nodes, check if any node still references this mesh
		const stillUsed = root.listNodes().some(n => n.getMesh() === mesh);
		if (!stillUsed) {
			mesh.dispose();
			removedMeshes++;
		}
	}
	console.log(`Cleaned up ${removedMeshes} orphaned meshes`);

	// Clean up orphaned accessors and buffers (gltf-transform handles this on write)

	// Also remove animation samplers that are no longer referenced
	for (const animation of animations) {
		const usedSamplers = new Set();
		for (const channel of animation.listChannels()) {
			usedSamplers.add(channel.getSampler());
		}
		for (const sampler of animation.listSamplers()) {
			if (!usedSamplers.has(sampler)) {
				sampler.dispose();
			}
		}
	}

	// Verify
	const channelsAfter = animations.reduce((sum, a) => sum + a.listChannels().length, 0);
	const remainingNodes = root.listNodes();
	const pyramidChildren = [];
	function countChildren(node) {
		for (const child of node.listChildren()) {
			pyramidChildren.push(child);
			countChildren(child);
		}
	}
	countChildren(fallbackRoot);

	const particleMeshes = pyramidChildren.filter(n => {
		const name = (n.getName() || '').toLowerCase();
		return n.getMesh() && (name.includes('particle') || name.includes('_remesh'));
	});

	console.log('\nVerification:');
	console.log(`  Pyramid root (${fallbackRoot.getName()}): OK`);
	console.log(`  Remaining nodes under root: ${pyramidChildren.length}`);
	console.log(`    Particle/remesh meshes: ${particleMeshes.length}`);
	console.log(`  Total scene nodes: ${remainingNodes.length}`);
	console.log(`  Animation channels: ${channelsBefore} → ${channelsAfter}`);

	// Prune unreferenced accessors, buffers, and other resources.
	// keepLeaves: true preserves empty leaf nodes — the Sign_* annotation
	// anchors are mesh-less empties under Forest; default prune would delete
	// them and break annotation positioning.
	console.log('\nPruning unreferenced data...');
	await document.transform(prune({ keepLeaves: true }), dedup());

	// Write output
	console.log('Writing stripped GLB...');
	await io.write(GLB_OUTPUT, document);

	const newSize = statSync(GLB_OUTPUT).size;
	const saved = originalSize - newSize;
	const pct = ((saved / originalSize) * 100).toFixed(1);

	console.log('\n' + '='.repeat(60));
	console.log('SUCCESS!');
	console.log(`  Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
	console.log(`  Stripped: ${(newSize / 1024 / 1024).toFixed(2)} MB`);
	console.log(`  Saved:    ${(saved / 1024 / 1024).toFixed(2)} MB (${pct}%)`);
	console.log(`  Removed:  ${removedNodes} nodes, ${removedChannels} channels, ${removedMeshes} meshes`);
	console.log('='.repeat(60));
}

main().catch(err => {
	console.error('FATAL:', err);
	process.exit(1);
});
