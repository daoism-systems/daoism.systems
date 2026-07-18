"""
Blender Python Script: Convert the mobile FBX into the mobile full-scene GLB.

Mobile counterpart of `convert_fbx_to_glb.py`, mirroring the desktop GLB shape:
animation is reduced to the same 12 group/camera clips and the pyramid base
meshes are stripped — pyramid visuals come from the MOBILE VAT
(pyramids_mobile_merged.glb / pyramids_mobile_vat.bin.gz /
pyramids_mobile_source.glb, baked by `bake_pyramid_vat.py -- --mobile` from the
same mobile FBX). Unlike the desktop pipeline there is no separate strip step:
the solids are deleted here before export, so no re-encode pass is needed.

Shared with the desktop conversion (must stay in sync with the runtime):
  1. Camera `Full_Camera_60FPS` (object + action) is renamed to `Full_Camera_01`
     so `modelAssembly.resolveSceneModelObjects` finds it via getObjectByName.
  2. Scene frame range is extended to the full action range (the FBX stores a
     stale 1..250 render range while the animation runs to ~2801).
  3. Animation is reduced to the 12 allowlisted group/camera clips. All clips
     span the identical 1..2801 range — load-bearing, because
     `AnimationController.setScrollProgress` scrubs each clip by its OWN
     duration. The export asserts this invariant.

Usage:
  blender --background --python scripts/convert_fbx_to_glb_mobile.py
  node scripts/optimize_mobile_scene.mjs   # then: resample keys + dedup + draco
  blender --background --python scripts/bake_pyramid_vat.py -- --mobile
"""

import bpy
import os

# -- Configuration ----------------------------------------------------
PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS_DIR = os.path.join(PROJECT_DIR, "static/models")
FBX_INPUT = os.path.join(MODELS_DIR, "DAO_60fps_mobile_07.fbx")

MOBILE_SCENE_OUTPUT = os.path.join(MODELS_DIR, "DAO_mobile_scene.glb")

CAMERA_OLD_NAME = "Full_Camera_60FPS"
CAMERA_NEW_NAME = "Full_Camera_01"

# Objects whose animation is KEPT — the same 12 clips as the desktop GLB
# (see convert_fbx_to_glb.py ANIM_KEEP_OBJECTS). Pyramid motion lives in the
# mobile VAT instead.
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

PYRAMID_ROOT_CANDIDATES = ("pyramids_1", "Pyramids")

# Draco params — match scripts/convert_fbx_to_glb.py so compression is uniform.
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

    # Rename the action so the exported clip name matches the desktop GLB
    # (`Full_Camera_01|CINEMA_4D_Main|Layer0`). Not strictly required for the
    # runtime's /camera/i match, but keeps clip names identical across tiers.
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


def assert_uniform_action_ranges():
    """Every clip must span the same range — `setScrollProgress` normalizes each
    action by its own duration, so a short clip would desync from the timeline."""
    ranges = {
        (round(a.frame_range[0]), round(a.frame_range[1])) for a in bpy.data.actions
    }
    if len(ranges) != 1:
        raise ValueError(
            f"Actions have {len(ranges)} distinct frame ranges {sorted(ranges)}; "
            "all clips must span the same range for scroll-scrub timing to hold."
        )
    print(f"All {len(bpy.data.actions)} actions span {next(iter(ranges))}")


def reduce_full_scene_animation():
    """Clear animation on every object outside the allowlist, then purge the
    now-orphaned actions — same reduction as the desktop convert script."""
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

    keep_prefixes = tuple(name + "|" for name in ANIM_KEEP_OBJECTS)
    removed = 0
    for action in list(bpy.data.actions):
        if not action.name.startswith(keep_prefixes):
            bpy.data.actions.remove(action)
            removed += 1
    print(f"Purged {removed} orphaned actions; {len(bpy.data.actions)} remain")


def strip_pyramid_base_meshes():
    """Delete the solid pyramid meshes (VAT renders them), keeping the
    particle/_remesh subtrees — mirrors scripts/strip_pyramid_bases.{mjs,py}."""
    root = None
    for candidate in PYRAMID_ROOT_CANDIDATES:
        root = bpy.data.objects.get(candidate)
        if root is not None:
            break
    if root is None:
        raise ValueError(f"Pyramid root not found (tried {PYRAMID_ROOT_CANDIDATES})")

    to_remove = []

    def collect(obj):
        name_lower = obj.name.lower()
        if "particle" in name_lower:
            return
        if obj.type == "MESH" and "_remesh" not in name_lower:
            to_remove.append(obj)
        for child in obj.children:
            collect(child)

    collect(root)

    for obj in to_remove:
        mesh_data = obj.data if obj.type == "MESH" else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh_data and mesh_data.users == 0:
            bpy.data.meshes.remove(mesh_data)

    print(f"Stripped {len(to_remove)} pyramid base meshes (VAT renders them)")


def export_mobile_scene():
    print(f"\nExporting mobile scene -> {MOBILE_SCENE_OUTPUT}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=MOBILE_SCENE_OUTPUT,
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
    size_mb = os.path.getsize(MOBILE_SCENE_OUTPUT) / (1024 * 1024)
    print(f"  -> {MOBILE_SCENE_OUTPUT} ({size_mb:.2f} MB)")


def main():
    print("=" * 60)
    print("Convert mobile DAO FBX -> DAO_mobile_scene.glb")
    print("=" * 60)

    clear_scene()
    import_fbx(FBX_INPUT)

    rename_camera()
    extend_frame_range()
    assert_uniform_action_ranges()

    reduce_full_scene_animation()
    strip_pyramid_base_meshes()
    export_mobile_scene()

    print("\n" + "=" * 60)
    print("SUCCESS!")
    print("  Next: run `node scripts/optimize_mobile_scene.mjs`")
    print("=" * 60)


if __name__ == "__main__":
    main()
