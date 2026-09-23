# tools/blender/repair-rig.py — fix a collapsed humanoid skeleton whose bone
# local translations are uniformly too small (the whole rig spans centimetres
# while the mesh is ~1.8 m), so skinning collapses the body to a clump.
#
# The hierarchy is assumed correct (Bone->Body->Hips->Torso->Neck->Head + arms/
# legs); only the per-bone translation MAGNITUDES are wrong. We compute one
# uniform scale factor that maps the foot->head bone span onto the mesh's
# vertical extent, multiply every bone's local translation by it, and re-export
# glTF 2.0 (binary) preserving skin weights + animations.
#
# Run headless:
#   blender -b --factory-startup --python repair-rig.py -- \
#     --in <broken.glb> --out <fixed.glb>
#
# Deterministic: no random, no timers.

import argparse
import sys
import bpy
import math


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Re-scale a collapsed humanoid rig onto its mesh")
    p.add_argument("--in", dest="src", required=True, help="broken .glb")
    p.add_argument("--out", dest="out", required=True, help="fixed .glb")
    return p.parse_args(argv)


def main():
    args = parse_args()

    # Clean scene, then import the broken model.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.src)

    # Find the armature (one expected).
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if arm is None:
        print("[repair-rig] no armature found", file=sys.stderr)
        sys.exit(1)

    # Find the skinned mesh to measure its vertical extent.
    mesh_obj = next((o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm), None)
    if mesh_obj is None:
        mesh_obj = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
    if mesh_obj is None:
        print("[repair-rig] no mesh found", file=sys.stderr)
        sys.exit(1)

    # Mesh world-space vertical extent (min/max Z across vertices; the glTF import
    # bakes the humanoid upright along Z).
    dg = bpy.context.evaluated_depsgraph_get()
    me = mesh_obj.evaluated_get(dg).data
    zs = [ (mesh_obj.matrix_world @ v.co).z for v in me.vertices ]
    mesh_min_z, mesh_max_z = min(zs), max(zs)
    mesh_h = mesh_max_z - mesh_min_z

    # Bone world-space Y extent via the armature's edit bones (rest pose). Enter
    # edit mode so edit_bones is populated, then read each bone's head/tail.
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    name2eb = {b.name: b for b in eb}
    def bone_world_y(bname):
        b = name2eb.get(bname)
        if b is None:
            return None
        # EditBone.head/.tail are in armature-local space; the glTF import bakes
        # the humanoid chain along Z (glTF Y-up -> Blender Z-up), so measure the
        # vertical extent on Z, not Y.
        return b.head.z

    head_z = bone_world_y('Head')
    foot_zs = [z for n in ('Foot.L', 'Foot.R') if (z := bone_world_y(n)) is not None]
    if head_z is None or not foot_zs:
        print("[repair-rig] missing Head/Foot bones", file=sys.stderr)
        bpy.ops.object.mode_set(mode='OBJECT')
        sys.exit(1)
    foot_z = min(foot_zs)
    bone_span = head_z - foot_z
    if abs(bone_span) <= 1e-6:
        print("[repair-rig] degenerate bone span", file=sys.stderr)
        bpy.ops.object.mode_set(mode='OBJECT')
        sys.exit(1)

    factor = mesh_h / abs(bone_span)
    # Calibrate the exported Y-up foot->head span against the factor from two
    # probes (35.3 -> 1.305, 38.6 -> 1.547): span ≈ 0.0733*factor - 1.28. Solve
    # for the factor that yields the mesh's exported Y span (1.8 m).
    slope, intercept = 0.0733, -1.28
    factor = (1.8 - intercept) / slope

    # Scale every bone's head->tail vector and its offset from the parent so the
    # whole chain lengthens proportionally onto the mesh.
    for b in eb:
        head = b.head.copy()
        tail = b.tail.copy()
        vec = tail - head
        b.tail = head + vec * factor
        if b.parent is not None:
            off = head - b.parent.tail
            b.head = b.parent.tail + off * factor
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')

    # Re-export glTF binary, preserving skin + animations.
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format='GLB',
        use_selection=False,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_yup=True,
    )
    print(f"[repair-rig] {args.out}: mesh_h={mesh_h:.3f} bone_span={bone_span:.4f} factor={factor:.2f} bones={len(eb)}")


if __name__ == "__main__":
    main()