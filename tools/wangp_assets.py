#!/usr/bin/env python3
"""tools/wangp_assets.py — generate game assets through a local Wan2GP session.

Runs the in-process Wan2GP headless API (shared/api.py WanGPSession) instead of
scraping the Gradio UI at :7860, so jobs can run on a pinned GPU while the live
server keeps serving the UI. Wraps the two model types this project uses:

  image  qwen_image_21_7B  (text-to-image, ref-image edit, control+mask inpaint)
         z_image           (text-to-image only, LoRA-capable)
  audio  yue2              (text-to-song: lyrics + style, optional ABC score)

Job specs are JSON files (or inline JSON strings). A spec is either a bare
Wan2GP settings dict, or a project-level manifest:

  { "kind": "image" | "audio",
    "name": "poster_wanted",            # used for output_filename + copy name
    "prompt": "...", "style": "...",    # audio: prompt=lyrics, style=alt_prompt
    "seed": 42, "resolution": "1024x1024", "steps": 40, "cfg": 4.0,
    "duration_seconds": 120,            # audio only (upper bound, not target)
    "loras": ["mattias_1024_z_2.safetensors"],   # resolved under <WanGP>/loras/<model>/
    "refs": ["path.png"], "mask": "path.png", "guide": "path.png",  # image edits
    "custom_guide": "score.abc",        # audio only (.abc score)
    "custom_settings": {"save_score": 1},
    "settings": { ... }                 # raw passthrough merged last (wins)
  }

Everything not listed is filled from the model's factory defaults
(get_default_settings), so specs stay tiny.

Usage:
  tools/wangp_assets.py spec.json [spec2.json ...]
      [--visible 2] [--profile 2] [--out DIR] [--timeout 900]
      [--dry-run]        validate each task (validate_task) and exit
      [--json]           machine-readable result lines on stdout
      [--return-media]   keep tensors in the result artifacts (return_media)

Notes / gotchas (verified against Wan2GP v13.13):
  - Relative attachment paths resolve against the Wan2GP root (cwd is chdir'd
    during a run), so pass absolute paths.
  - Image tasks: qwen21/z_image force image_mode>=1 and generate exactly 1
    frame; batch_size<=16. `resolution` must be a WxH string.
  - Inpaint on qwen21 needs video_prompt_type containing "I" (refs) or "V"
    (control image) plus "A" for the mask; the wrapper infers this from
    refs/guide + mask. Mask/guide paths are read from disk by generate_media.
  - yue2: duration_seconds is an upper bound; the song can end earlier.
    custom_settings.save_score=1 exports .abc/.mid side files. The score
    (AR) stage runs ~2 tok/s, so a full song needs 30-45 min: pass a large
    --timeout. On timeout the job is cancelled and drained, because the job
    thread is a daemon and exiting while it runs aborts the interpreter.
  - One generation at a time per session; specs run sequentially.
"""

import argparse
import json
import os
import shutil
import sys
import traceback
from pathlib import Path

WANGP_ROOT = Path(os.environ.get("WANGP_ROOT", "/home/mgr/Wan2GP"))
IMAGE_MODEL = "qwen_image_21_7B"
IMAGE_MODEL_ALT = "z_image"
AUDIO_MODEL = "yue2"


def _abs(p):
    if p is None:
        return None
    q = Path(str(p)).expanduser()
    return str(q if q.is_absolute() else (Path.cwd() / q).resolve())


def build_settings(session, spec):
    """Turn a project-level spec into a full Wan2GP settings dict."""
    kind = spec.get("kind", "image")
    if kind == "audio":
        model_type = spec.get("model_type", AUDIO_MODEL)
    elif kind == "image":
        model_type = spec.get("model_type", IMAGE_MODEL)
    else:
        raise ValueError(f"unknown kind {kind!r}")

    settings = dict(session.get_default_settings(model_type))
    settings["model_type"] = model_type
    settings["seed"] = int(spec.get("seed", -1))

    if kind == "audio":
        settings["prompt"] = spec.get("prompt", settings.get("prompt", ""))
        settings["alt_prompt"] = spec.get("style", spec.get("alt_prompt", ""))
        if "duration_seconds" in spec:
            settings["duration_seconds"] = int(spec["duration_seconds"])
        if "steps" in spec:
            settings["num_inference_steps"] = int(spec["steps"])
        if "cfg" in spec:
            settings["guidance_scale"] = float(spec["cfg"])
        if "model_mode" in spec:
            settings["model_mode"] = int(spec["model_mode"])
        if "audio_prompt_type" in spec:
            settings["audio_prompt_type"] = str(spec["audio_prompt_type"])
        if "audio_guide" in spec:
            settings["audio_guide"] = _abs(spec["audio_guide"])
        if "custom_guide" in spec:
            settings["custom_guide"] = _abs(spec["custom_guide"])
    else:
        settings["prompt"] = spec.get("prompt", settings.get("prompt", ""))
        settings["negative_prompt"] = spec.get("negative_prompt", settings.get("negative_prompt", " "))
        settings["resolution"] = str(spec.get("resolution", settings.get("resolution", "1024x1024")))
        if "steps" in spec:
            settings["num_inference_steps"] = int(spec["steps"])
        if "cfg" in spec:
            settings["guidance_scale"] = float(spec["cfg"])
        if "batch_size" in spec:
            settings["batch_size"] = int(spec["batch_size"])
        refs = [_abs(r) for r in spec.get("refs", [])]
        if refs:
            settings["image_refs"] = refs
            settings["image_mode"] = 3
            settings["video_prompt_type"] = "I"
        guide = _abs(spec.get("guide"))
        if guide:
            settings["image_guide"] = guide
            settings["image_mode"] = 3
            settings["video_prompt_type"] = "V"
        mask = _abs(spec.get("mask"))
        if mask:
            settings["image_mask"] = mask
            vpt = settings.get("video_prompt_type", "")
            if "A" not in vpt:
                settings["video_prompt_type"] = vpt + "A"
        if "image_prompt_type" in spec:
            settings["image_prompt_type"] = str(spec["image_prompt_type"])
        if "model_mode" in spec:
            settings["model_mode"] = spec["model_mode"]

    loras = spec.get("loras", [])
    if loras:
        lora_dir = WANGP_ROOT / "loras" / model_type
        settings["activated_loras"] = [
            str(lora_dir / l) if not os.path.isabs(l) and not l.startswith("http") else l
            for l in loras
        ]
        if "loras_multipliers" in spec:
            settings["loras_multipliers"] = str(spec["loras_multipliers"])

    cs = spec.get("custom_settings")
    if isinstance(cs, dict) and cs:
        base = settings.get("custom_settings")
        merged = dict(base) if isinstance(base, dict) else {}
        merged.update(cs)
        settings["custom_settings"] = merged

    name = spec.get("name")
    if name:
        settings["output_filename"] = str(name)

    raw = spec.get("settings")
    if isinstance(raw, dict):
        settings.update(raw)

    if spec.get("return_media"):
        settings["_api"] = {"return_media": True}
    return settings


def main():
    ap = argparse.ArgumentParser(description="Generate game assets via local Wan2GP")
    ap.add_argument("specs", nargs="+", help="JSON spec files or inline JSON strings")
    ap.add_argument("--visible", default="2", help="physical GPU index to pin (CUDA_VISIBLE_DEVICES); '' to leave unset")
    ap.add_argument("--profile", default="2", help="mmgp offload profile")
    ap.add_argument("--out", type=Path, default=None, help="copy outputs here (default: spec dir)")
    ap.add_argument("--timeout", type=float, default=900.0, help="seconds per spec")
    ap.add_argument("--dry-run", action="store_true", help="validate tasks and exit without generating")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON result lines")
    ap.add_argument("--return-media", action="store_true", help="ask the API for in-memory tensors too")
    args = ap.parse_args()

    specs = []
    for raw in args.specs:
        p = Path(str(raw).strip("'\"")).expanduser()
        if p.exists():
            specs.append((p.resolve(), json.loads(p.read_text())))
        else:
            specs.append((Path.cwd() / f"inline_{abs(hash(str(raw)))}.json", json.loads(raw)))

    if args.visible != "":
        os.environ["CUDA_VISIBLE_DEVICES"] = args.visible
    sys.path.insert(0, str(WANGP_ROOT))
    from shared.api import init

    session = init(
        root=WANGP_ROOT,
        cli_args=["--attention", "sdpa", "--profile", args.profile],
        console_output=not args.json,
    )
    wgp = session._ensure_runtime().module
    wgp.server_config["enhancer_enabled"] = 0  # keep VRAM for the main model

    ok_all = True
    for spec_path, spec in specs:
        try:
            settings = build_settings(session, spec)
        except Exception as exc:
            ok_all = False
            print(json.dumps({"ok": False, "spec": str(spec_path), "error": f"spec: {exc}"}) if args.json
                  else f"[spec error] {spec_path}: {exc}")
            continue

        inputs, err = wgp.validate_task({"params": dict(settings)}, session._state)
        if err:
            ok_all = False
            print(json.dumps({"ok": False, "spec": str(spec_path), "error": f"validation: {err}"}) if args.json
                  else f"[invalid] {spec_path}: {err}")
            continue
        if args.dry_run:
            print(json.dumps({"ok": True, "spec": str(spec_path), "validated": True,
                              "model_type": settings.get("model_type")}) if args.json
                  else f"[valid] {spec_path} ({settings.get('model_type')})")
            continue

        if args.return_media:
            settings["_api"] = {"return_media": True}
        job = session.submit_task(settings)
        try:
            result = job.result(timeout=args.timeout)
        except TimeoutError:
            # The job thread is a daemon: if we exit while it still runs, its
            # mmgp/CUDA worker is killed mid-run and aborts the interpreter.
            # Cancel, then drain the job so the worker unwinds cleanly.
            ok_all = False
            job.cancel()
            try:
                job.result(timeout=120)
            except TimeoutError:
                pass
            msg = f"timeout after {args.timeout:.0f}s (job cancelled)"
            print(json.dumps({"ok": False, "spec": str(spec_path), "error": msg}) if args.json
                  else f"[timeout] {spec_path}: {msg}")
            continue
        if not result.success:
            ok_all = False
            print(json.dumps({"ok": False, "spec": str(spec_path),
                              "errors": [e.message for e in result.errors]}) if args.json
                  else f"[failed] {spec_path}: {[e.message for e in result.errors]}")
            continue

        out_dir = args.out or spec_path.resolve().parent
        out_dir.mkdir(parents=True, exist_ok=True)
        copied = []
        for src in result.generated_files:
            srcp = Path(src)
            if not srcp.is_absolute():
                srcp = WANGP_ROOT / srcp
            dst = out_dir / srcp.name
            shutil.copy2(srcp, dst)
            copied.append(str(dst))
            if not args.json:
                print(f"[file] {dst}")
        extras = {}
        for art in result.artifacts:
            for fname, data in (art.side_files or {}).items():
                side = out_dir / fname
                side.write_bytes(data)
                extras.setdefault("side_files", []).append(str(side))
        print(json.dumps({"ok": True, "spec": str(spec_path), "files": copied, **extras}) if args.json
              else f"[done] {spec_path}: {len(copied)} file(s)")

    session.close()
    return 0 if ok_all else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("[interrupted]", file=sys.stderr)
        sys.exit(130)
    except Exception:
        traceback.print_exc()
        sys.exit(1)