"""
Blender Python Script: Convert the source FBX into the full-scene GLB the
runtime loads.

This reproduces the previously-manual Blender export step so the FBX -> GLB
conversion is repeatable and committed. It emits:

  - DAO_full_scene.glb  (PRE-strip)
        The whole scene with Draco compression, but with animation kept ONLY on
        the 12 group/camera objects that the shipped scene actually animates
        (Camera, Octagon + 3 inner rings, Cubes, Sausages, object_01..05).
        Per-leaf motion is intentionally dropped — fine pyramid/cube/octagon
        motion is reproduced at runtime by the VAT + particle systems, exactly
        as in the current build. Run `strip_pyramid_bases` afterwards to remove
        the pyramid base meshes.

The pyramid VAT (pyramids_merged.glb / pyramids_vat.bin / pyramids_source.glb)
is baked separately by `bake_pyramid_vat.py`, which reads the FBX directly —
no GLB intermediate, because a GLB round-trip silently drops the per-object
pyramid animation.

Required modifications baked in here (vs. a naive FBX export):
  1. Camera `Full_Camera_60FPS` (object + action) is renamed to `Full_Camera_01`
     so `modelAssembly.resolveSceneModelObjects` finds it via getObjectByName.
  2. Scene frame range is extended to the full action range (the FBX stores a
     stale 1..250 render range while the animation runs to ~2801) — otherwise
     the exported camera clip is truncated to a few seconds.
  3. Full-scene animation is reduced to the 12 group/camera clips to match the
     current DAO_full_scene.glb (which has exactly these 12).

Usage:
  blender --background --python scripts/convert_fbx_to_glb.py
"""

import bpy
import os

# -- Configuration ----------------------------------------------------
PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS_DIR = os.path.join(PROJECT_DIR, "static/models")
FBX_INPUT = os.path.join(MODELS_DIR, "DAO_60fps_01.fbx")

FULL_SCENE_OUTPUT = os.path.join(MODELS_DIR, "DAO_full_scene.glb")

CAMERA_OLD_NAME = "Full_Camera_60FPS"
CAMERA_NEW_NAME = "Full_Camera_01"

# Objects whose animation is KEPT in the full-scene GLB. These are exactly the
# clips present in the current shipped DAO_full_scene.glb. Everything else has
# its animation cleared so the export reproduces the current 12-clip structure.
ANIM_KEEP_OBJECTS = {
    "Cubes",
    "Sausages",
    "object_01",
    "object_02",
    "object_03",
    "object_04",
    "object_05",
    "Octagon",
    "inner_01",
    "inner_02",
    "Inner_03",
    CAMERA_NEW_NAME,
}

# Draco params — match scripts/strip_pyramid_bases.py so compression is uniform.
DRACO_POSITION_Q = 14
DRACO_NORMAL_Q = 10
DRACO_TEXCOORD_Q = 12
DRACO_LEVEL = 6
# ---------------------------------------------------------------------


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)


def import_fbx(filepath):
    print(f"Importing {filepath} ...")
    bpy.ops.import_scene.fbx(filepath=filepath)
    print(f"  Imported {len(bpy.data.objects)} objects")


def find_object_by_name(name):
    for obj in bpy.data.objects:
        if obj.name == name or obj.name.startswith(name + "."):
            return obj
    return None


def rename_camera():
    """Rename the camera object + its action to the runtime-expected name."""
    cam = find_object_by_name(CAMERA_OLD_NAME)
    if cam is None:
        # Already renamed, or a differently-named camera.
        existing = find_object_by_name(CAMERA_NEW_NAME)
        if existing is not None:
            print(f"Camera already named {CAMERA_NEW_NAME!r}")
            return
        cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
        raise ValueError(
            f"Camera {CAMERA_OLD_NAME!r} not found. Cameras present: "
            + str([c.name for c in cams])
        )

    old_action_name = None
    if cam.animation_data and cam.animation_data.action:
        old_action_name = cam.animation_data.action.name

    cam.name = CAMERA_NEW_NAME
    if cam.data:
        cam.data.name = CAMERA_NEW_NAME

    # Rename the action so the exported clip name matches the current GLB
    # (`Full_Camera_01|CINEMA_4D_Main|Layer0`). Not strictly required for the
    # runtime's /camera/i match, but keeps clip names identical to today.
    if old_action_name:
        action = cam.animation_data.action
        action.name = old_action_name.replace(CAMERA_OLD_NAME, CAMERA_NEW_NAME, 1)
        print(f"Renamed camera -> {CAMERA_NEW_NAME!r}, action -> {action.name!r}")
    else:
        print(f"Renamed camera -> {CAMERA_NEW_NAME!r} (no action found)")


def extend_frame_range():
    """The FBX render range is stale (1..250); animation runs much longer.
    Extend the scene range to the max action frame so exports capture it all."""
    scene = bpy.context.scene
    max_frame = scene.frame_end
    for action in bpy.data.actions:
        action_end = int(action.frame_range[1])
        if action_end > max_frame:
            max_frame = action_end
    scene.frame_start = 1
    scene.frame_end = max_frame
    print(
        f"Scene fps={scene.render.fps}, frame range set to "
        f"{scene.frame_start}..{scene.frame_end}"
    )


def reduce_full_scene_animation():
    """Clear animation on every object outside the allowlist, then purge the
    now-orphaned actions, so the full-scene export contains only the 12
    group/camera clips that match the current shipped GLB."""
    scene = bpy.context.scene
    # Freeze leaf objects at the start pose before clearing their animation.
    scene.frame_set(scene.frame_start)
    bpy.context.evaluated_depsgraph_get().update()

    cleared = 0
    for obj in bpy.data.objects:
        if obj.name in ANIM_KEEP_OBJECTS:
            continue
        if obj.animation_data:
            obj.animation_data_clear()
            cleared += 1
    print(f"\nCleared animation on {cleared} non-allowlist objects")

    # Keep only actions whose name belongs to an allowlisted object
    # (action names are `<ObjectName>|CINEMA_4D_Main|Layer0`; the trailing '|'
    # delimiter prevents object_01 / object_010-style prefix collisions).
    keep_prefixes = tuple(name + "|" for name in ANIM_KEEP_OBJECTS)
    removed = 0
    for action in list(bpy.data.actions):
        if not action.name.startswith(keep_prefixes):
            bpy.data.actions.remove(action)
            removed += 1
    print(f"Purged {removed} orphaned actions; {len(bpy.data.actions)} remain")
    for a in sorted(bpy.data.actions, key=lambda x: x.name):
        print(f"  kept action: {a.name}")


def export_full_scene():
    print(f"\nExporting full scene -> {FULL_SCENE_OUTPUT}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=FULL_SCENE_OUTPUT,
        use_selection=False,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_normals=True,
        export_extras=True,
        export_apply=False,
        export_attributes=True,
        export_cameras=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=DRACO_LEVEL,
        export_draco_position_quantization=DRACO_POSITION_Q,
        export_draco_normal_quantization=DRACO_NORMAL_Q,
        export_draco_texcoord_quantization=DRACO_TEXCOORD_Q,
    )
    size_mb = os.path.getsize(FULL_SCENE_OUTPUT) / (1024 * 1024)
    print(f"  -> {FULL_SCENE_OUTPUT} ({size_mb:.2f} MB)")


def main():
    print("=" * 60)
    print("Convert DAO FBX -> DAO_full_scene.glb")
    print("=" * 60)

    clear_scene()
    import_fbx(FBX_INPUT)

    rename_camera()
    extend_frame_range()

    # Reduce to the 12-clip set and export the full scene.
    reduce_full_scene_animation()
    export_full_scene()

    print("\n" + "=" * 60)
    print("SUCCESS!")
    print("  Next: run strip_pyramid_bases, then bake_pyramid_vat.py")
    print("=" * 60)


if __name__ == "__main__":
    main()
