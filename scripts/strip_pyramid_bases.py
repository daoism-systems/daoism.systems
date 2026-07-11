"""
Blender Python Script: Strip Pyramid Base Meshes from DAO_full_scene.glb

Removes ~409 pyramid base mesh objects and their animation tracks from the
main scene GLB. These meshes are replaced at runtime by the PyramidVAT system
(pyramids_merged.glb + pyramids_vat.bin).

What is PRESERVED:
  - Pyramid root group node (visibility toggling)
  - Particle / _remesh source meshes + their animation tracks (drive particles)
  - All parent empty nodes (particle meshes inherit their transforms)
  - Everything non-pyramid (Octagon, Sausages, Forest, Signs, Camera, etc.)

Usage:
  blender --background --python scripts/strip_pyramid_bases.py
"""

import bpy
import os

# ── Configuration ──────────────────────────────────────────────────
PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GLB_INPUT = os.path.join(PROJECT_DIR, "static/models/DAO_full_scene.glb")
GLB_OUTPUT = os.path.join(PROJECT_DIR, "static/models/DAO_full_scene.glb")  # overwrite
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
    """Import a GLB file."""
    print(f"Importing {filepath}...")
    bpy.ops.import_scene.gltf(filepath=filepath)
    print(f"  Imported {len(bpy.data.objects)} objects")


def find_object_by_name(name):
    """Find an object by name in the scene."""
    for obj in bpy.data.objects:
        if obj.name == name or obj.name.startswith(name + '.'):
            return obj
    return None


def find_pyramid_root():
    """Resolve pyramid root for legacy and new scene exports."""
    for candidate in PYRAMID_ROOT_CANDIDATES:
        root = find_object_by_name(candidate)
        if root is not None:
            return root

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
    """
    Find all non-particle mesh objects under pyramid root.
    Same logic as bake_pyramid_vat.py to ensure consistency.
    """
    root = find_pyramid_root()

    print(f"Found root: {root.name}")
    meshes = []

    def collect(obj):
        name_lower = obj.name.lower()
        # Skip particle groups and remesh (particle source) objects
        if 'particle' in name_lower or '_remesh' in name_lower:
            return
        if obj.type == 'MESH':
            meshes.append(obj)
        for child in obj.children:
            collect(child)

    collect(root)
    return meshes


def clear_animation_data(base_meshes):
    """
    Clear animation data (NLA strips) from base pyramid meshes before deletion.

    GLB imports store per-object animation as NLA strips referencing a shared
    action. Clearing animation_data before deletion ensures clean removal.
    Also strips any fcurves in shared actions that reference these objects.
    """
    cleared = 0
    base_mesh_names = set(obj.name for obj in base_meshes)

    # Clear per-object animation data (NLA tracks/strips)
    for obj in base_meshes:
        if obj.animation_data:
            obj.animation_data_clear()
            cleared += 1

    # Also check parent empties that only served base meshes
    # (their NLA data may reference the shared action)
    for obj in bpy.data.objects:
        if obj.type != 'EMPTY' or obj.name in base_mesh_names:
            continue
        if not obj.animation_data:
            continue
        # Check if this empty only has base mesh children (no particle/remesh)
        has_non_base_child = False
        for child in obj.children:
            if child.type == 'MESH':
                name_lower = child.name.lower()
                if 'particle' in name_lower or '_remesh' in name_lower:
                    has_non_base_child = True
                    break
                if child.name not in base_mesh_names:
                    has_non_base_child = True
                    break
            elif child.type == 'EMPTY' and len(child.children) > 0:
                has_non_base_child = True
                break
        # Only clear if all children are base meshes (now deleted)
        if not has_non_base_child and len(obj.children) == 0:
            obj.animation_data_clear()
            cleared += 1

    # Remove any fcurves in shared actions that reference base meshes
    fcurves_removed = 0
    for action in bpy.data.actions:
        to_remove = []
        for fcurve in action.fcurves:
            if fcurve.group and fcurve.group.name in base_mesh_names:
                to_remove.append(fcurve)
                continue
            for name in base_mesh_names:
                if name in fcurve.data_path:
                    to_remove.append(fcurve)
                    break
        for fcurve in to_remove:
            action.fcurves.remove(fcurve)
            fcurves_removed += 1

    return cleared, fcurves_removed


def delete_base_meshes(base_meshes):
    """Delete base pyramid mesh objects and their mesh data."""
    deleted_count = 0
    mesh_data_to_remove = []

    for obj in base_meshes:
        # Track mesh data for cleanup
        if obj.data and obj.data.users <= 1:
            mesh_data_to_remove.append(obj.data)

        bpy.data.objects.remove(obj, do_unlink=True)
        deleted_count += 1

    # Clean up orphaned mesh data blocks
    cleaned_meshes = 0
    for mesh_data in mesh_data_to_remove:
        try:
            if mesh_data.users == 0:
                bpy.data.meshes.remove(mesh_data)
                cleaned_meshes += 1
        except ReferenceError:
            pass  # Already removed

    # Second pass: clean any remaining orphaned mesh data
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
            cleaned_meshes += 1

    return deleted_count, cleaned_meshes


def clean_empty_actions():
    """Remove actions that have zero fcurves after pruning."""
    removed = 0
    for action in list(bpy.data.actions):
        if len(action.fcurves) == 0 and action.users == 0:
            bpy.data.actions.remove(action)
            removed += 1
    return removed


def verify_scene(base_mesh_names):
    """Verify the scene is intact after stripping."""
    # Check pyramid root still exists
    try:
        root = find_pyramid_root()
    except ValueError:
        print("  WARNING: Pyramid root group node is missing!")
        return False

    # Count remaining objects under pyramid root
    remaining_meshes = 0
    remaining_empties = 0
    particle_meshes = 0

    def count(obj):
        nonlocal remaining_meshes, remaining_empties, particle_meshes
        if obj.type == 'MESH':
            remaining_meshes += 1
            name_lower = obj.name.lower()
            if 'particle' in name_lower or '_remesh' in name_lower:
                particle_meshes += 1
        elif obj.type == 'EMPTY':
            remaining_empties += 1
        for child in obj.children:
            count(child)

    count(root)

    print(f"  Pyramid root ({root.name}): OK")
    print(f"  Remaining meshes under root: {remaining_meshes}")
    print(f"    Particle/remesh meshes: {particle_meshes}")
    print(f"  Remaining empties: {remaining_empties}")

    # Check no base meshes remain
    for name in base_mesh_names:
        if name in bpy.data.objects:
            print(f"  WARNING: Base mesh '{name}' still exists!")
            return False

    # Check total scene object count
    print(f"  Total scene objects: {len(bpy.data.objects)}")
    print(f"  Total actions: {len(bpy.data.actions)}")
    total_fcurves = sum(len(a.fcurves) for a in bpy.data.actions)
    print(f"  Total fcurves: {total_fcurves}")

    return True


def export_glb(output_path):
    """Export the full scene as GLB."""
    # Select all objects for export
    bpy.ops.object.select_all(action='SELECT')

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        use_selection=False,  # Export entire scene
        export_format='GLB',
        export_animations=True,
        export_normals=True,
        export_extras=True,
        export_apply=False,
        export_attributes=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Exported: {output_path} ({size_mb:.2f} MB)")
    return size_mb


def main():
    print("=" * 60)
    print("Strip Pyramid Base Meshes from DAO_full_scene.glb")
    print("=" * 60)

    # Record original file size
    original_size_mb = os.path.getsize(GLB_INPUT) / (1024 * 1024)
    print(f"Original file size: {original_size_mb:.2f} MB")

    # 1. Clear and import
    clear_scene()
    import_glb(GLB_INPUT)

    # Count initial stats
    initial_objects = len(bpy.data.objects)
    initial_fcurves = sum(len(a.fcurves) for a in bpy.data.actions)
    print(f"Initial: {initial_objects} objects, {initial_fcurves} fcurves")

    # 2. Find base pyramid meshes
    base_meshes = get_pyramid_base_meshes()
    print(f"\nFound {len(base_meshes)} pyramid base meshes to remove")
    if not base_meshes:
        print("Nothing to strip — exiting.")
        return

    print(f"  First 5: {[m.name for m in base_meshes[:5]]}")
    print(f"  Last 5: {[m.name for m in base_meshes[-5:]]}")

    # Collect names before deletion
    base_mesh_names = set(obj.name for obj in base_meshes)

    # 3. Clear animation data (NLA strips) on base meshes before deletion
    print("\nClearing animation data...")
    cleared_anim, removed_fcurves = clear_animation_data(base_meshes)
    print(f"  Cleared animation data on {cleared_anim} objects")
    if removed_fcurves:
        print(f"  Removed {removed_fcurves} fcurves from shared actions")

    # 4. Delete base mesh objects
    print("\nDeleting base mesh objects...")
    deleted_meshes, cleaned_data = delete_base_meshes(base_meshes)
    print(f"  Deleted {deleted_meshes} mesh objects")
    print(f"  Cleaned {cleaned_data} orphaned mesh data blocks")

    # 5. Clean up empty actions
    removed_actions = clean_empty_actions()
    if removed_actions:
        print(f"  Removed {removed_actions} empty actions")

    # 6. Verify scene integrity
    print("\nVerification:")
    ok = verify_scene(base_mesh_names)

    if not ok:
        print("\nERROR: Scene verification failed! Not exporting.")
        return

    # 7. Export
    print("\nExporting stripped GLB...")
    new_size_mb = export_glb(GLB_OUTPUT)

    # Summary
    reduction = original_size_mb - new_size_mb
    pct = (reduction / original_size_mb) * 100 if original_size_mb > 0 else 0
    print("\n" + "=" * 60)
    print("SUCCESS!")
    print(f"  Original: {original_size_mb:.2f} MB")
    print(f"  Stripped: {new_size_mb:.2f} MB")
    print(f"  Saved:    {reduction:.2f} MB ({pct:.1f}%)")
    print(f"  Removed:  {deleted_meshes} meshes, {removed_fcurves} fcurves")
    print("=" * 60)


if __name__ == "__main__":
    main()
