# /// script
# requires-python = ">=3.11"
# ///
"""UV-unwrap a retopologized zombie mesh and bake the source candidate's
textures onto its new UVs (Ralph round 6, v5 zombie upgrade).

Run headless:
  blender -b --factory-startup --python tools/blender/bake-tex.py -- \
      --low  .research/pixal3d-walker-finished.glb \
      --high .research/pixal3d-walker-candidate.glb \
      --out  .research/pixal3d-walker-baked.glb \
      --size 1024

The voxel-remesh finish step strips the candidate's UVs, so the low-poly mesh
has no TEXCOORD_0 and its material textures cannot map. This script:
  1. imports the low-poly (retopo) mesh and the high-poly candidate (with UVs),
  2. smart-UV-projects the low-poly mesh into a clean, non-overlapping layout,
  3. bakes the candidate's base-color + metallic-roughness onto the low-poly's
     new UVs via selected-to-active transfer (high -> low),
  4. rewires the low-poly material to the baked images and exports a GLB that
     carries TEXCOORD_0 + the baked textures.

Kept minimal and deterministic: fixed bake settings, no randomness.
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
    p = argparse.ArgumentParser(description="UV-unwrap + bake a retopo'd zombie mesh")
    p.add_argument("--low", dest="low", required=True, help="retopo'd (no-UV) .glb")
    p.add_argument("--high", dest="high", required=True, help="source candidate .glb (has UVs)")
    p.add_argument("--out", dest="out", required=True, help="output .glb path")
    p.add_argument("--size", dest="size", type=int, default=1024, help="bake texture size")
    return p.parse_args(argv)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def dominant_mesh():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh in scene")
    return max(meshes, key=lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons))


def import_low(path):
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    keep = max([o for o in new if o.type == "MESH"],
               key=lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons))
    for o in list(new):
        if o is keep:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    return keep


def import_high(path):
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before]
    keep = max([o for o in new if o.type == "MESH"],
               key=lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons))
    for o in list(new):
        if o is keep:
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    return keep


def smart_uv(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Enter edit mode and unwrap. angle_limit avoids overlapping islands.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj.data.uv_layers.active.name


def make_bake_image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    return img


def bake_channel(low, high, low_uv, image, channel):
    """Bake `channel` ('DIFFUSE' color or 'ROUGHNESS') from high -> low via
    selected-to-active, writing into `image` on the low mesh's active UV."""
    # Ensure the low mesh has a material with an image node targeted by `image`.
    mat = low.data.materials[0] if low.data.materials else None
    if mat is None:
        mat = bpy.data.materials.new("Baked")
        mat.use_nodes = True
        low.data.materials.append(mat)
    nt = mat.node_tree
    # Add (or reuse) an image texture node and make it the active bake target.
    node = None
    for n in nt.nodes:
        if n.type == "TEX_IMAGE" and n.image == image:
            node = n
            break
    if node is None:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
    nt.nodes.active = node
    # Select high then low (active) for selected-to-active transfer.
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    # Cycles bake settings.
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
        # Diffuse color-only bake: enable the COLOR pass, disable lighting passes.
        bk.use_pass_direct = False
        bk.use_pass_indirect = False
        bk.use_pass_color = True
    bpy.ops.object.bake(type=channel)
    return image


def rewire_material(low, color_img, mr_img):
    """Replace the low mesh's material with a clean PBR material wired to the
    baked base-color + metallic-roughness images."""
    mat = low.data.materials[0] if low.data.materials else None
    if mat is None:
        mat = bpy.data.materials.new("Baked")
        low.data.materials.append(mat)
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


def export_glb(obj, out):
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=False, export_materials="EXPORT",
        export_image_format="AUTO", export_cameras=False, export_lights=False,
        export_extras=False,
    )


def main():
    args = parse_args()
    clear_scene()
    low = import_low(args.low)
    high = import_high(args.high)
    uv_name = smart_uv(low)
    color = make_bake_image("baked_basecolor", args.size)
    mr = make_bake_image("baked_mr", args.size)
    mr.colorspace_settings.name = "Non-Color"
    bake_channel(low, high, uv_name, color, "DIFFUSE")
    bake_channel(low, high, uv_name, mr, "ROUGHNESS")
    rewire_material(low, color, mr)
    export_glb(low, args.out)
    print(f"[bake-tex] {args.out}: uv={uv_name} size={args.size}")


main()