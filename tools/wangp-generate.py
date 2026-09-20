#!/usr/bin/env python3
# tools/wangp-generate.py — submit WanGP settings files through the in-process
# shared/api.py session (no UI scraping). Pin to one GPU via --visible (physical
# index; sets CUDA_VISIBLE_DEVICES before torch initializes) so image jobs can
# run on the 3080 while the 3090s host inference.
#
# Usage:
#   tools/wangp-generate.py <settings.json> [more.json ...]
#       [--visible 2] [--profile 2] [--out DIR] [--timeout SECS]
# Copies each generated file into --out (default: next to the first settings file).
import argparse
import json
import os
import shutil
import sys
import traceback
from pathlib import Path

WANGP_ROOT = Path("/home/mgr/Wan2GP")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("settings", nargs="+", type=Path)
    ap.add_argument("--visible", default="2", help="physical GPU index to pin (CUDA_VISIBLE_DEVICES)")
    ap.add_argument("--profile", default="2", help="mmgp offload profile")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--timeout", type=float, default=900.0)
    args = ap.parse_args()

    if args.visible != "":
        os.environ["CUDA_VISIBLE_DEVICES"] = args.visible
    sys.path.insert(0, str(WANGP_ROOT))
    from shared.api import init

    session = init(root=WANGP_ROOT, cli_args=["--attention", "sdpa", "--profile", args.profile], console_output=False)
    wgp = session._ensure_runtime().module
    wgp.server_config["enhancer_enabled"] = 0  # keep VRAM for the image model

    out_dir = args.out or args.settings[0].resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for p in args.settings:
        settings = json.loads(p.read_text())
        loras = settings.get("activated_loras") or []
        settings["activated_loras"] = [
            str(WANGP_ROOT / "loras" / "z_image" / l) if not os.path.isabs(l) and not l.startswith("http") else l
            for l in loras
        ]
        job = session.submit_task(settings)
        result = job.result(timeout=args.timeout)
        if not result.success:
            print(json.dumps({"ok": False, "settings": str(p), "errors": [str(e) for e in result.errors]}))
            results.append(False)
            continue
        for src in result.generated_files:
            srcp = Path(src)
            if not srcp.is_absolute():
                srcp = WANGP_ROOT / srcp
            dst = out_dir / srcp.name
            shutil.copy2(srcp, dst)
            print(f"[file] {dst}")
            results.append(True)
    print(json.dumps({"ok": all(results), "count": len(results)}))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
