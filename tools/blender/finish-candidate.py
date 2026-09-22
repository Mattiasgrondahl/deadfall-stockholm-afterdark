# tools/blender/finish-candidate.py — turn a Pixal3D image->3D candidate GLB into
# a game-ready zombie GLB. Run headless:
#   blender -b --factory-startup --python finish-candidate.py -- \
#     --in  <candidate.glb> --rig <mixamo.fbx> --out <walker.glb> \
#     --tris 3000 --height 1.8
#
# Steps (deterministic, no random):
#   1. import candidate, join meshes, scale to a target standing height (metres)
#      so the in-game hitbox anchors (torso y1.2 / head y1.8) line up.
#   2. retopologize to <= --tris triangles (decimate collapse, non-destructive
#      of UVs where possible).
#   3. import the Mixamo FBX armature, parent the mesh with automatic weights.
#   4. export glTF 2.0 (binary) with the armature + skinned mesh, PBR textures.
#
# The script is a recipe: it assumes a single humanoid candidate and a single
# Mixamo skeleton. Batch types differ only by --in/--rig/--out/--height.

import argparse
import sys
import bpy


def parse_args():
    # Everything after "--" on the blender command line lands in sys.argv[1:].
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Finish a Pixal3D candidate into a game GLB")
    p.add_argument("--in", dest="src", required=True, help="Pixal3D candidate .glb")
    p.add_argument("--rig", dest="rig", default=None, help="Mixamo .fbx armature (optional)")
    p.add_argument("--rig-glb", dest="rig_glb", default=None, help="rig + animation .glb armature (optional)")
    p.add_argument("--out", dest="out", required=True, help="output .glb path")
    p.add_argument("--tris", dest="tris", type=int, default=3000, help="max triangles")
    p.add_argument("--height", dest="height", type=float, default=1.8, help="standing height in metres")
    return p.parse_args(argv)


def clear_scene():
    # Delete every object, including the startup Cube, which in background mode
    # may not appear in the view-layer object list at script time.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def import_candidate(path):
    bpy.ops.import_scene.gltf(filepath=path)
    # The Pixal3D export bundles scene extras (a placeholder Cube, a Camera, a
    # Light) alongside the real mesh (geometry_0). Keep only the real mesh:
    # delete non-mesh objects and any mesh that is not the dominant one.
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("candidate GLB has no mesh")
    # Dominant mesh = the one with the most polygons (the generated body).
    def tri_count(o):
        return sum(len(p.vertices) - 2 for p in o.data.polygons)
    keep = max(meshes, key=tri_count)
    for o in list(bpy.context.scene.objects):
        if o is keep:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    return [keep]


def join_and_scale(meshes, target_height):
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # Scale so the bounding-box height matches the target standing height.
    dims = obj.dimensions
    if dims.z > 1e-6:
        s = target_height / dims.z
        obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def retopo(obj, max_tris):
    """Reduce to <= max_tris triangles.

    The Pixal3D candidate is a dense remeshed voxel shell (~1M tris) whose
    collapse-decimate floor is ~25k, so plain collapse can't reach a 2-3k
    budget. We voxel-remesh at a resolution chosen to land near the target,
    then finish with a light collapse pass. Voxel remesh gives a predictable
    triangle count from the voxel size, which is what makes this deterministic.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    # Already under budget (e.g. a baked mesh that just needs rigging): keep the
    # existing topology and its UVs untouched.
    start_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if start_tris <= max_tris:
        return start_tris
    dims = obj.dimensions
    # Search voxel sizes (fine -> coarse) and keep the FINEST pass that still
    # fits the budget, so we preserve as much silhouette detail as possible.
    best = None
    for div in (96, 80, 64, 48, 40, 32, 24):
        vox = max(dims) / float(div)
        mod = obj.modifiers.new("vox", "REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = vox
        mod.use_remove_disconnected = False
        bpy.ops.object.modifier_apply(modifier=mod.name)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris <= max_tris:
            best = tris
            break
    if best is None:
        # Even the coarsest voxel pass overshot; take the last (coarsest) result.
        best = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    # Fine-tune down to the budget with a collapse pass if still over.
    if best > max_tris:
        ratio = max_tris / best
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        best = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return best


def import_rig(path, mesh):
    bpy.ops.import_scene.fbx(filepath=path)
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("rig FBX has no armature")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    return arm


def import_rig_glb(path, mesh):
    """Parent the mesh to a GLB armature (e.g. a Mixamo/RobotExpressive humanoid
    rig) with automatic weights. The armature's animation actions come along and
    are exported with the skin, so the output GLB is rigged + animated."""
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("rig GLB has no armature")
    # Drop the rig GLB's own meshes/cameras/lights so only the armature remains.
    for o in list(new):
        if o is arm:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    # Match the rig's standing height to the mesh's before parenting so automatic
    # weights land on the right bones (the candidate is scaled to --height).
    try:
        md = arm.dimensions.z
        if md > 1e-6 and mesh.dimensions.z > 1e-6:
            s = mesh.dimensions.z / md
            arm.scale = (s, s, s)
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.select_all(action="DESELECT")
            arm.select_set(True)
            bpy.ops.object.transform_apply(scale=True)
    except Exception:
        pass
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # Drop any stale skin state (vertex groups / armature modifier / parent) so
    # ARMATURE_AUTO builds clean weights the glTF exporter accepts as a skin.
    for vg in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(vg)
    for m in list(mesh.modifiers):
        if m.type == "ARMATURE":
            mesh.modifiers.remove(m)
    if mesh.parent and mesh.parent.type == "ARMATURE":
        mesh.parent = None
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # parent_set parents the mesh to a deform BONE (parent_type "BONE"), which
    # makes the glTF exporter drop the skin (it treats a bone-parented mesh as
    # already-bound). Re-parent to the armature OBJECT so the skin is exported.
    if mesh.parent == arm:
        mesh.parent_type = "OBJECT"
        mesh.matrix_parent_inverse = arm.matrix_world.inverted()
    return arm


def export_glb(obj, arm, out):
    # Purge any orphaned mesh/material/image data left by the candidate import
    # (the Pixal3D GLB bundles a placeholder Cube + Camera + Light as scene
    # nodes; removing the objects can leave orphan data the exporter re-emits).
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    if arm is not None:
        arm.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=arm is not None,
    )


def rescale_to_height(obj, target_height):
    """Re-scale the (retopologized) mesh so its bounding-box height is exact."""
    dims = obj.dimensions
    if dims.z > 1e-6:
        s = target_height / dims.z
        obj.scale = (s, s, s)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.ops.object.transform_apply(scale=True)


def main():
    args = parse_args()
    clear_scene()
    meshes = import_candidate(args.src)
    obj = join_and_scale(meshes, args.height)
    final_tris = retopo(obj, args.tris)
    rescale_to_height(obj, args.height)  # voxel remesh can shift dims slightly
    arm = None
    if args.rig:
        arm = import_rig(args.rig, obj)
    elif args.rig_glb:
        arm = import_rig_glb(args.rig_glb, obj)
    export_glb(obj, arm, args.out)
    print(f"[finish-candidate] {args.out}: tris={final_tris} height={args.height} rig={'yes' if arm else 'no'}")


main()