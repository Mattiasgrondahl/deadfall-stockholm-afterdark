# /// script
# requires-python = ">=3.11"
# ///
"""One-shot finish + UV-bake + rig for a Pixal3D zombie candidate (Ralph round 6).

Run headless:
  blender -b --factory-startup --python tools/blender/finish-bake-rig.py -- \
      --in   .research/pixal3d-walker-candidate.glb \
      --rig  .research/mixamo/RobotExpressive.glb \
      --out  .research/pixal3d-walker-final.glb \
      --tris 3000 --height 1.8 --size 1024

Why one session: the glTF exporter only emits a skin when the skinned mesh was
built *in this scene* (a voxel-remeshed mesh re-imported from a GLB and re-rigged
loses the skin node). So we voxel-remesh -> smart-UV -> bake the candidate's
textures onto the new UVs -> import the rig GLB and parent with automatic
weights -> export a single GLB that carries POSITION/NORMAL/TEXCOORD_0/JOINTS_0/
WEIGHTS_0 + baked textures + the armature's animation clips.

Kept deterministic: fixed voxel/UV/bake settings, no randomness.
"""
import sys
import bpy


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    import argparse
    p = argparse.ArgumentParser(description="Finish + bake + rig a zombie candidate")
    p.add_argument("--in", dest="src", required=True, help="Pixal3D candidate .glb")
    p.add_argument("--rig", dest="rig", required=True, help="rig + animation .glb")
    p.add_argument("--out", dest="out", required=True, help="output .glb path")
    p.add_argument("--tris", dest="tris", type=int, default=3000, help="max triangles")
    p.add_argument("--height", dest="height", type=float, default=1.8, help="standing height")
    p.add_argument("--size", dest="size", type=int, default=1024, help="bake texture size")
    return p.parse_args(argv)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def import_candidate(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("candidate GLB has no mesh")
    keep = max(meshes, key=tri_count)
    for o in list(bpy.context.scene.objects):
        if o is keep:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    return keep


def join_and_scale(meshes, target_height):
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    dims = obj.dimensions
    if dims.z > 1e-6:
        s = target_height / dims.z
        obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def retopo(obj, max_tris):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    dims = obj.dimensions
    best = tri_count(obj)
    chosen = None
    for div in (96, 80, 64, 48, 40, 32, 24):
        for m in list(obj.modifiers):
            obj.modifiers.remove(m)
        mod = obj.modifiers.new("remesh", "REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = max(dims) / div
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            continue
        n = tri_count(obj)
        if n <= max_tris:
            chosen = n
            break
    if chosen is None:
        chosen = tri_count(obj)
    if chosen > max_tris:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max_tris / chosen
        bpy.ops.object.modifier_apply(modifier=mod.name)
        chosen = tri_count(obj)
    return chosen


def rescale_to_height(obj, target_height):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    dims = obj.dimensions
    if dims.z > 1e-6:
        s = target_height / dims.z
        obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)


def remember_source_uvs(obj):
    """Snapshot the candidate's UV layer (if any) so the bake can sample the
    source textures after the voxel remesh wipes the live UVs."""
    uv = obj.data.uv_layers.active if obj.data.uv_layers else None
    return uv.name if uv else None


def smart_uv(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj.data.uv_layers.active.name


def make_bake_image(name, size, noncolor=False):
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    return img


def bake_selected_to_active(low, high, image, channel):
    """Bake the high-poly candidate's material (sampled via its source UVs) onto
    the low-poly retopo's new UVs via selected-to-active transfer."""
    mat = low.data.materials[0] if low.data.materials else None
    if mat is None:
        mat = bpy.data.materials.new("Baked")
        low.data.materials.append(mat)
    nt = mat.node_tree
    node = None
    for n in nt.nodes:
        if n.type == "TEX_IMAGE" and n.image == image:
            node = n
            break
    if node is None:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
    nt.nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    bk = scene.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = 0.08
    bk.max_ray_distance = 0.25
    bk.margin = 8
    bk.use_clear = True
    if channel == "DIFFUSE":
        bk.use_pass_direct = False
        bk.use_pass_indirect = False
        bk.use_pass_color = True
    bpy.ops.object.bake(type=channel)
    return image


def rewire_material(obj, color_img, mr_img):
    mat = obj.data.materials[0] if obj.data.materials else bpy.data.materials.new("Baked")
    if not obj.data.materials:
        obj.data.materials.append(mat)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    cnode = nt.nodes.new("ShaderNodeTexImage")
    cnode.image = color_img
    nt.links.new(cnode.outputs["Color"], bsdf.inputs["Base Color"])
    if mr_img is not None:
        mnode = nt.nodes.new("ShaderNodeTexImage")
        mnode.image = mr_img
        nt.links.new(mnode.outputs["Color"], bsdf.inputs["Roughness"])
    return mat


def import_rig_glb(path, mesh):
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("rig GLB has no armature")
    for o in list(new):
        if o is arm:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
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
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    if mesh.parent == arm:
        mesh.parent_type = "OBJECT"
        mesh.matrix_parent_inverse = arm.matrix_world.inverted()
    return arm


def export_glb(obj, arm, out):
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    if arm is not None:
        arm.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=False, export_skins=True,
        export_materials="EXPORT", export_image_format="AUTO",
        export_cameras=False, export_lights=False, export_extras=False,
        export_animations=arm is not None,
    )


def main():
    args = parse_args()
    clear_scene()
    meshes = [import_candidate(args.src)]
    obj = join_and_scale(meshes, args.height)
    # Keep a hidden copy of the (UV'd) candidate as the bake source: the voxel
    # remesh wipes the live UVs, so selected-to-active needs the original.
    high = obj.copy()
    high.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(high)
    high.hide_render = True
    src_uv = remember_source_uvs(high)
    final_tris = retopo(obj, args.tris)
    rescale_to_height(obj, args.height)
    new_uv = smart_uv(obj)
    color = make_bake_image("baked_basecolor", args.size)
    mr = make_bake_image("baked_mr", args.size, noncolor=True)
    bake_selected_to_active(obj, high, color, "DIFFUSE")
    bake_selected_to_active(obj, high, mr, "ROUGHNESS")
    rewire_material(obj, color, mr)
    arm = import_rig_glb(args.rig, obj)
    # Unlink the bake source so it is not exported.
    bpy.data.objects.remove(high, do_unlink=True)
    export_glb(obj, arm, args.out)
    print(f"[finish-bake-rig] {args.out}: tris={final_tris} height={args.height} uv={new_uv} src_uv={src_uv} rig={'yes' if arm else 'no'}")


main()