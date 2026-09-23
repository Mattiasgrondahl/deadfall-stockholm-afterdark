# tools/blender/repair-rig.py — rebuild a correct humanoid skeleton for the
# walker mesh. The source walker-final.glb has a coherent bone HIERARCHY but the
# bone REST POSITIONS are corrupted (the chain is laid along Z at ~cm scale and
# my earlier rescale compounded into a 12 m mess with the head at -9 m). Rather
# than scale the broken chain, we assign correct humanoid bone positions directly
# (feet at y 0, hips ~0.95, head ~1.7) following the existing parent chain, then
# re-export glTF 2.0 preserving skin weights + the mesh.
#
# Run headless:
#   blender -b --factory-startup --python repair-rig.py -- \
#     --in <broken.glb> --out <fixed.glb>
#
# Deterministic: no random, no timers.

import argparse
import sys
import bpy


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Rebuild a correct humanoid skeleton")
    p.add_argument("--in", dest="src", required=True, help="broken .glb")
    p.add_argument("--out", dest="out", required=True, help="fixed .glb")
    return p.parse_args(argv)


# Target humanoid bone HEAD positions in armature-local space (glTF Y-up baked
# to Blender Z-up, so "up" is +Z). Feet ~0, hips ~0.95, chest ~1.2, head ~1.65.
BONE_HEAD = {
    'Bone': (0.0, 0.0, 0.0),
    'Body': (0.0, 0.0, 0.95),
    'Hips': (0.0, 0.0, 0.95),
    'Abdomen': (0.0, 0.0, 1.05),
    'Torso': (0.0, 0.0, 1.2),
    'Neck': (0.0, 0.0, 1.45),
    'Head': (0.0, 0.0, 1.6),
    'Shoulder.L': (0.18, 0.0, 1.35),
    'UpperArm.L': (0.28, 0.0, 1.3),
    'LowerArm.L': (0.28, 0.0, 1.0),
    'Palm1.L': (0.28, 0.0, 0.85),
    'Palm2.L': (0.28, 0.0, 0.82),
    'Palm3.L': (0.28, 0.0, 0.82),
    'Thumb.L': (0.31, 0.0, 0.85),
    'Thumb2.L': (0.33, 0.0, 0.82),
    'Index.L': (0.30, 0.0, 0.8),
    'Index2.L': (0.30, 0.0, 0.76),
    'Middle1.L': (0.29, 0.0, 0.8),
    'Middle2.L': (0.29, 0.0, 0.75),
    'Ring1.L': (0.27, 0.0, 0.8),
    'Ring2.L': (0.27, 0.0, 0.75),
    'UpperLeg.L': (0.1, 0.0, 0.9),
    'LowerLeg.L': (0.1, 0.0, 0.45),
    'Foot.L': (0.1, 0.0, 0.05),
    'PoleTarget.L': (0.1, 0.0, 0.0),
}
# Mirror .L -> .R for the right side.
MIRROR_X = {'Shoulder', 'UpperArm', 'LowerArm', 'Palm1', 'Palm2', 'Palm3',
            'Thumb', 'Thumb2', 'Index', 'Index2', 'Middle1', 'Middle2',
            'Ring1', 'Ring2', 'UpperLeg', 'LowerLeg', 'Foot', 'PoleTarget'}


def target_for(name):
    if name in BONE_HEAD:
        return BONE_HEAD[name]
    if name.endswith('.R'):
        base = name[:-2]
        if base in BONE_HEAD and base.split('.')[0] in MIRROR_X:
            x, y, z = BONE_HEAD[base]
            return (-x, y, z)
    return None


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.src)

    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if arm is None:
        print("[repair-rig] no armature", file=sys.stderr)
        sys.exit(1)

    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    name2eb = {b.name: b for b in eb}

    # Reposition each bone's head to the target humanoid layout; keep the chain
    # connected by pointing each child's head at its parent's tail direction.
    for b in eb:
        tgt = target_for(b.name)
        if tgt is None:
            continue
        b.head = tgt
        # Give the bone a sensible length along +Z (or toward its parent's
        # child side) so the skeleton reads as a humanoid.
        b.tail = (tgt[0], tgt[1], tgt[2] + 0.12)
        b.use_connect = False

    bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format='GLB',
        use_selection=False,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_yup=True,
    )
    print(f"[repair-rig] {args.out}: rebuilt {len(eb)} bones to humanoid layout")


if __name__ == "__main__":
    main()