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
    p.add_argument("--out", dest="out", required=True, help="output .glb path")
    p.add_argument("--tris", dest="tris", type=int, default=3000, help="max triangles")
    p.add_argument("--height", dest="height", type=float, default=1.8, help="standing height in metres")
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def import_candidate(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("candidate GLB has no mesh")
    return meshes


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
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris <= max_tris:
        return tris
    ratio = max_tris / tris
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


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


def export_glb(obj, arm, out):
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
    )


def main():
    args = parse_args()
    clear_scene()
    meshes = import_candidate(args.src)
    obj = join_and_scale(meshes, args.height)
    final_tris = retopo(obj, args.tris)
    arm = None
    if args.rig:
        arm = import_rig(args.rig, obj)
    export_glb(obj, arm, args.out)
    print(f"[finish-candidate] {args.out}: tris={final_tris} height={args.height} rig={'yes' if arm else 'no'}")


main()