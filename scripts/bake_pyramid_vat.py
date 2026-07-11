"""
Blender Python Script: Bake Pyramid VAT assets.

Generates:
  - pyramids_merged.glb  (merged pyramid base mesh for VAT rendering)
  - pyramids_vat.bin     (per-object ABSOLUTE world transform per frame, Y-up)
  - pyramids_source.glb  (pyramid particle/remesh hierarchy only, with animation)

The source GLB is exported from the fallback scene asset so runtime does not need
to load the full legacy DAO scene just to recover pyramid particle animation.
"""

import bpy
import bmesh
import numpy as np
import struct
import gzip
import os
import sys
import mathutils

# ── Configuration ──────────────────────────────────────────────────
# Sample every Nth frame. The runtime particle cloud is driven by the source
# GLB's full-resolution AnimationMixer, while the solid pyramids are this baked
# VAT, linearly interpolated between baked keys in the shader. Any step > 1 lets
# the two diverge wherever the motion is faster than the bake cadence — the new
# source has near-instant (1-frame) positional jumps, so step=6 smeared a
# 1-frame jump across 0.1s and the cloud visibly separated from the solid mesh
# and flickered on scrub. step=1 makes the VAT sample exactly the frames the
# mixer does, so they stay locked together. The trailing static held pose is
# trimmed below, so this does not bloat the .bin with duplicate frames — but it
# is still the dominant size lever (raise to 2 to roughly halve the .bin at the
# cost of a 1-frame mismatch through the fastest jumps, which fall under the
# cloud cover at progress ~0.41).
FRAME_STEP = 1
# glTF carries no fps, so a re-imported GLB defaults to Blender's 24fps. The
# source animation is authored at 60fps; pin it here so the bake samples the
# native frame resolution (~2801 frames) instead of a 24fps-resampled subset.
SOURCE_FPS = 60
PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# Bake straight from the FBX. A GLB round-trip silently drops the per-object
# pyramid animation: SCENE export mode collapses to a single channel and ACTIONS
# mode re-imports as muted NLA tracks that don't evaluate on frame_set — either
# way the VAT freezes at the rest pose. FBX import makes every action active, so
# frame_set evaluates the full morph.
SOURCE_INPUT = os.path.join(PROJECT_DIR, "static/models/DAO_60fps_01.fbx")
GLB_INPUT = SOURCE_INPUT
OUTPUT_DIR = os.path.join(PROJECT_DIR, "static/models")
MESH_OUTPUT = os.path.join(OUTPUT_DIR, "pyramids_merged.glb")
VAT_OUTPUT = os.path.join(OUTPUT_DIR, "pyramids_vat.bin")
SOURCE_OUTPUT = os.path.join(OUTPUT_DIR, "pyramids_source.glb")
PYRAMID_ROOT_CANDIDATES = ("pyramids_1", "Pyramids")
# ───────────────────────────────────────────────────────────────────


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)


def import_glb(filepath):
    """Import a source file (FBX or GLB) by extension."""
    print(f"Importing {filepath}...")
    if filepath.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=filepath)
    else:
        bpy.ops.import_scene.gltf(filepath=filepath)
    print(f"  Imported {len(bpy.data.objects)} objects")


def find_object_by_name(name):
    """Find an object by name in the scene."""
    for obj in bpy.data.objects:
        if obj.name == name or obj.name.startswith(name + '.'):
            return obj
    return None


def find_pyramid_root():
    """
    Resolve the pyramid root group in a schema-tolerant way.
    Supports legacy DAO.glb (pyramids_1) and newer exports (Pyramids).
    """
    for candidate in PYRAMID_ROOT_CANDIDATES:
        root = find_object_by_name(candidate)
        if root is not None:
            return root

    # Fallback: any object with "pyramid" in name
    for obj in bpy.data.objects:
        if "pyramid" in obj.name.lower():
            return obj

    available = sorted([o.name for o in bpy.data.objects if o.name])[:40]
    raise ValueError(
        "Pyramid root not found. Tried "
        + str(PYRAMID_ROOT_CANDIDATES)
        + " and name contains 'pyramid'. "
        + "Available objects (first 40): "
        + str(available)
    )


def get_pyramid_base_meshes():
    """Find solid pyramid mesh objects under pyramid root.

    Skips entire *particle* subtrees — those nodes (and their *_remesh leaves)
    are particle-source geometry the runtime turns into particle systems.
    Standalone *_remesh meshes that live OUTSIDE a particle subtree (e.g.
    Polygon_remesh under Glass_2_2) are kept: they're real solid pyramid bodies
    not covered by any other VAT mesh.
    """
    root = find_pyramid_root()

    print(f"Found root: {root.name}")
    meshes = []

    def collect(obj):
        name_lower = obj.name.lower()
        if 'particle' in name_lower:
            return
        if obj.type == 'MESH':
            meshes.append(obj)
        for child in obj.children:
            collect(child)

    collect(root)
    return meshes


def collect_pyramid_subtree(root):
    """Collect the pyramid root and all descendants."""
    result = []

    def collect(obj):
        result.append(obj)
        for child in obj.children:
            collect(child)

    collect(root)
    return result


def remove_pyramid_base_meshes(root):
    """Delete non-particle pyramid base meshes, keeping particle/remesh hierarchy."""
    to_remove = []

    def collect(obj):
        name_lower = obj.name.lower()
        if obj.type == 'MESH' and 'particle' not in name_lower and '_remesh' not in name_lower:
            to_remove.append(obj)
            return
        for child in obj.children:
            collect(child)

    collect(root)

    for obj in to_remove:
        mesh_data = obj.data if obj.type == 'MESH' else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh_data and mesh_data.users == 0:
            bpy.data.meshes.remove(mesh_data)

    return len(to_remove)


def bake_absolute_transforms(base_meshes, frames, scene):
    """
    Bake ABSOLUTE world transforms per object per frame.

    Converts from Blender Z-up to glTF Y-up coordinate system:
      mat_gltf = C @ mat_blender @ C_inv

    The shader applies this directly to local-space vertices (which the
    glTF exporter also converted to Y-up), giving correct Y-up world positions.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    n_objects = len(base_meshes)
    n_frames = len(frames)
    transforms = np.empty((n_frames, n_objects, 3, 4), dtype=np.float32)

    # Blender Z-up → glTF Y-up: rotate -90° around X
    C = np.array([
        [1,  0,  0,  0],
        [0,  0,  1,  0],
        [0, -1,  0,  0],
        [0,  0,  0,  1],
    ], dtype=np.float64)
    C_inv = np.array([
        [1,  0,  0,  0],
        [0,  0, -1,  0],
        [0,  1,  0,  0],
        [0,  0,  0,  1],
    ], dtype=np.float64)

    for fi, frame in enumerate(frames):
        scene.frame_set(frame)
        depsgraph.update()

        for oi, obj in enumerate(base_meshes):
            eval_obj = obj.evaluated_get(depsgraph)
            mat = np.array(eval_obj.matrix_world, dtype=np.float64)
            # Convert to Y-up: C * mat * C_inv
            mat_gltf = C @ mat @ C_inv
            transforms[fi, oi] = mat_gltf[:3, :].astype(np.float32)

        if fi % 30 == 0 or fi == n_frames - 1:
            print(f"  Baked frame {fi + 1}/{n_frames} (scene frame {frame})")

    return transforms


def build_merged_mesh(base_meshes):
    """
    Merge all base meshes into one in LOCAL object space (no world transform).
    The shader applies the world transform from the VAT.
    Stores objectIndex as a vertex color layer.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()

    obj_idx_layer = bm.verts.layers.float.new('objectIndex')

    for oi, obj in enumerate(base_meshes):
        eval_obj = obj.evaluated_get(depsgraph)
        eval_mesh = eval_obj.to_mesh()

        old_vert_count = len(bm.verts)

        bm.from_mesh(eval_mesh)
        bm.verts.ensure_lookup_table()

        # NO world transform — keep vertices in local object space
        # Just set the objectIndex
        for vi in range(old_vert_count, len(bm.verts)):
            bm.verts[vi][obj_idx_layer] = float(oi)

        eval_obj.to_mesh_clear()

    bm.normal_update()

    mesh_data = bpy.data.meshes.new("PyramidsMerged")
    bm.to_mesh(mesh_data)
    bm.free()
    mesh_data.update()

    n_verts = len(mesh_data.vertices)

    # Read objectIndex from the float attribute
    obj_indices = np.zeros(n_verts, dtype=np.float32)
    if 'objectIndex' in mesh_data.attributes:
        attr = mesh_data.attributes['objectIndex']
        for i in range(n_verts):
            obj_indices[i] = attr.data[i].value
    else:
        vert_offset = 0
        for oi, obj in enumerate(base_meshes):
            eval_obj = obj.evaluated_get(depsgraph)
            eval_mesh = eval_obj.to_mesh()
            nv = len(eval_mesh.vertices)
            obj_indices[vert_offset:vert_offset + nv] = float(oi)
            vert_offset += nv
            eval_obj.to_mesh_clear()

    max_idx = len(base_meshes) - 1
    if max_idx == 0:
        max_idx = 1

    if 'objectIndex' in mesh_data.attributes:
        mesh_data.attributes.remove(mesh_data.attributes['objectIndex'])

    color_attr = mesh_data.color_attributes.new(
        name='objectIndex',
        type='FLOAT_COLOR',
        domain='CORNER'
    )

    for poly in mesh_data.polygons:
        for loop_idx in poly.loop_indices:
            vi = mesh_data.loops[loop_idx].vertex_index
            idx = int(obj_indices[vi])
            color_attr.data[loop_idx].color = (idx / 512.0, 0.0, 0.0, 1.0)

    mesh_data.update()

    merged_obj = bpy.data.objects.new("PyramidsMerged", mesh_data)
    bpy.context.collection.objects.link(merged_obj)

    return merged_obj, n_verts, max_idx + 1


def export_merged_glb(merged_obj, output_path):
    """Export the merged mesh as GLB."""
    bpy.ops.object.select_all(action='DESELECT')
    merged_obj.select_set(True)
    bpy.context.view_layer.objects.active = merged_obj

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        use_selection=True,
        export_format='GLB',
        export_animations=False,
        export_normals=True,
        export_materials='NONE',
        export_extras=True,
        export_apply=False,
        export_attributes=True,
    )
    size_kb = os.path.getsize(output_path) / 1024
    print(f"Exported mesh: {output_path} ({size_kb:.1f} KB)")


def export_pyramid_source_glb(input_path, output_path):
    """Export a pyramid-only animated source GLB from the fallback scene."""
    clear_scene()
    bpy.context.scene.render.fps = SOURCE_FPS
    import_glb(input_path)

    scene = bpy.context.scene
    root = find_pyramid_root()
    print(f"Preparing pyramid source export from root: {root.name}")

    # CRITICAL: the runtime reparents the pyramids_1 root under a rotation pivot
    # via Object3D.attach(), which rewrites the node's local transform to
    # preserve world position. If the root node is ALSO animated, the runtime
    # AnimationMixer overwrites that adjusted transform every frame, re-applying
    # the root's offset on top of the pivot — shifting every pyramid particle by
    # the root offset (~18u in Z). The FBX keyframes the root with a constant
    # value, so drop its animation entirely; only the children must animate.
    scene.frame_set(scene.frame_start)
    if root.animation_data:
        root.animation_data_clear()
        print(f"  Cleared animation on root '{root.name}' (pivot-safe static root)")

    removed_count = remove_pyramid_base_meshes(root)
    print(f"  Removed {removed_count} base meshes")

    subtree = collect_pyramid_subtree(root)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in subtree:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        use_selection=True,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        # CRITICAL: force per-frame sampling of the EVALUATED animation. Without
        # this the exporter wrote the FBX's sparse/STEP keyframes verbatim and 59
        # of 68 rotation tracks came out as 2-key STEP — so particle objects held
        # their REST rotation for the whole morph and snapped only at the end,
        # while the VAT solid (baked from frame_set) rotated smoothly. The cloud
        # looked un-rotated / desynced from the solid. force_sampling + optimize
        # off makes every rotation track a smooth per-frame LINEAR curve that
        # matches the VAT.
        export_force_sampling=True,
        export_optimize_animation_size=False,
        export_normals=True,
        export_materials='NONE',
        export_extras=True,
        export_apply=False,
        export_attributes=True,
    )

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Exported source: {output_path} ({size_kb:.1f} KB)")


def write_vat_binary(transforms, frames, fps, n_objects, output_path, full_duration):
    """Write transform animation data as binary.

    `full_duration` is the original (untrimmed) clip length in seconds that the
    runtime maps content-progress 0..1 across. When the static held tail is
    trimmed, time_end (last baked frame) < full_duration; the runtime maps
    progress to source time over full_duration, then clamps into [time_start,
    time_end] so the morph still completes at the same scroll point.
    """
    n_frames = len(frames)
    time_start = frames[0] / fps
    time_end = frames[-1] / fps

    header = struct.pack('<IIffff',
                         n_objects,
                         n_frames,
                         time_start,
                         time_end,
                         float(fps),
                         float(full_duration))
    header += b'\x00' * 8  # pad header to 32 bytes
    # Data: n_frames * n_objects * 12 floats (mat4x3 row-major)
    payload = header + transforms.tobytes()

    with open(output_path, 'wb') as f:
        f.write(payload)

    # Ship the gzipped bin: it's float32 rigid transforms with long all-zero
    # (scale-0) runs, so gzip shrinks it ~12x losslessly (e.g. 22.9 -> 1.8 MB).
    # The runtime fetches the .gz and inflates via DecompressionStream — far
    # cheaper than the raw download and better than any lossy quantization, which
    # only makes the data less compressible. mtime=0 keeps output deterministic
    # so an identical re-bake produces no git churn.
    gz_path = output_path + '.gz'
    with gzip.GzipFile(gz_path, 'wb', compresslevel=9, mtime=0) as gz:
        gz.write(payload)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    gz_mb = os.path.getsize(gz_path) / (1024 * 1024)
    print(f"VAT binary: {output_path} ({size_mb:.2f} MB)")
    print(f"VAT gzipped: {gz_path} ({gz_mb:.2f} MB)  <- shipped to runtime")
    print(f"  {n_objects} objects x {n_frames} frames")
    print(f"  Baked time range: {time_start:.2f}s - {time_end:.2f}s (maps over full {full_duration:.2f}s)")


def main():
    print("=" * 60)
    print("Pyramid VAT Baker (ABSOLUTE transforms)")
    print("=" * 60)

    # 1. Clear and import.
    # Pin fps to the source fps BEFORE importing: the glTF importer places
    # keyframes at time*fps using the scene fps at import time. GLB carries no
    # fps (Blender defaults to 24), which would resample the 60fps source down
    # to a ~1120-frame range. Setting it first preserves the native ~2801 frames.
    clear_scene()
    bpy.context.scene.render.fps = SOURCE_FPS
    import_glb(GLB_INPUT)

    scene = bpy.context.scene
    scene.render.fps = SOURCE_FPS  # keep pinned (defensive; import shouldn't change it)
    fps = scene.render.fps

    # Extend frame range to cover full animation. Track the REAL last keyframe
    # (anim_end_frame) separately from the +1-extended bake range: the runtime
    # particle mixer's clip duration is the source GLB's last keyframe time
    # (= anim_end_frame / fps), and the VAT's fullDuration must equal it exactly
    # or the GPU solid drifts ~1 frame ahead of the CPU particles during the
    # fast explosion. Using the extended frame_end here (one frame longer) was the
    # bug that desynced them mid-morph.
    max_frame = scene.frame_end
    anim_end_frame = scene.frame_start
    for action in bpy.data.actions:
        last_key = int(action.frame_range[1])
        anim_end_frame = max(anim_end_frame, last_key)
        action_end = last_key + 1
        if action_end > max_frame:
            max_frame = action_end
    scene.frame_end = max_frame
    print(f"Scene fps: {fps}, frame range: {scene.frame_start}-{scene.frame_end}, anim end frame: {anim_end_frame}")

    # 2. Find base meshes
    base_meshes = get_pyramid_base_meshes()
    print(f"Found {len(base_meshes)} pyramid base meshes")
    if not base_meshes:
        print("WARNING: No pyramid base meshes found. Skipping VAT regeneration and preserving existing VAT assets.")
    else:
        print(f"  First 5: {[m.name for m in base_meshes[:5]]}")
        print(f"  Last 5: {[m.name for m in base_meshes[-5:]]}")

        # 3. Determine frames
        frames = list(range(scene.frame_start, scene.frame_end + 1, FRAME_STEP))
        if frames[-1] != scene.frame_end:
            frames.append(scene.frame_end)
        print(f"Baking {len(frames)} frames (step={FRAME_STEP})")

        # 4. Bake absolute world transforms (converted to Y-up)
        print("\nBaking absolute transforms...")
        transforms = bake_absolute_transforms(base_meshes, frames, scene)

        # 4b. Trim the trailing static held pose. The source animation completes
        # its morph partway through (the pyramids explode/fly out as the cloud
        # transition covers them) then holds an identical pose for the rest of the
        # clip. Baking those duplicate frames only bloats the .bin; the runtime
        # clamps progress past the morph end to the last baked frame (see
        # PyramidVAT.setProgress). full_duration is the REAL animation length
        # (anim_end_frame, NOT the +1-extended frame_end) so it matches the
        # particle mixer's GLB clip duration exactly — content-progress 0..1 maps
        # across the same timeline for both, keeping the GPU solid and CPU
        # particles phase-locked through the explosion.
        full_duration = anim_end_frame / fps
        last_motion = 0
        for fi in range(1, len(frames)):
            if np.abs(transforms[fi] - transforms[fi - 1]).max() > 1e-4:
                last_motion = fi
        keep = min(len(frames) - 1, last_motion + 1)  # +1 frame so the held pose is represented
        if keep < len(frames) - 1:
            print(
                f"Trimming static tail: {len(frames)} -> {keep + 1} frames "
                f"(last motion at baked frame {last_motion} / {(last_motion / (len(frames) - 1)):.3f} of clip)"
            )
            frames = frames[:keep + 1]
            transforms = transforms[:keep + 1]
        else:
            print("No trailing static tail detected (motion runs to the final frame).")

        # 5. Build merged mesh in LOCAL space (no world transform).
        # Reset to rest frame first — bake_absolute_transforms left the depsgraph
        # at the last frame, which would otherwise freeze the merged mesh in its
        # end-of-animation pose.
        scene.frame_set(scene.frame_start)
        bpy.context.evaluated_depsgraph_get().update()
        print("\nBuilding merged mesh (local space)...")
        merged_obj, vertex_count, n_objects = build_merged_mesh(base_meshes)
        print(f"  {vertex_count} vertices, {len(merged_obj.data.polygons)} faces, {n_objects} objects")

        # 6. Export
        print("\nExporting...")
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        export_merged_glb(merged_obj, MESH_OUTPUT)
        write_vat_binary(transforms, frames, fps, n_objects, VAT_OUTPUT, full_duration)

        # 7. Cleanup merged export objects before building the source GLB
        mesh_data = merged_obj.data
        bpy.data.objects.remove(merged_obj, do_unlink=True)
        bpy.data.meshes.remove(mesh_data)

    # 8. Export dedicated pyramid particle source from the fallback scene
    print("\nExporting pyramid source hierarchy...")
    export_pyramid_source_glb(SOURCE_INPUT, SOURCE_OUTPUT)

    print("\n" + "=" * 60)
    print("SUCCESS!")
    print("=" * 60)


if __name__ == "__main__":
    main()
