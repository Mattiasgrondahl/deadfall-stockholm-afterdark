#!/usr/bin/env python3
"""Visual-inspect a gameplay screenshot with a local VLM on the GPU.

MiniCPM-V-2_6 is gated (needs a HF token), so this uses the open
Qwen/Qwen2-VL-2B-Instruct checkpoint, which runs comfortably on the 3080.
Answers whether the zombie BODY is actually visible on screen (vs a shadow-only
silhouette). Downloads the checkpoint on first run (cached under
~/.cache/huggingface).

Usage: python mcpm_vision.py --image <path> [--question "..."] [--device cuda:2]
"""
import argparse
import torch
from PIL import Image
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--question", default=(
        "This is a screenshot from a third-person 3D zombie game. "
        "In the center of the frame there should be a humanoid zombie character. "
        "Describe what you see in the center of the image. "
        "Is there a visible zombie BODY (a humanoid figure with torso, head, arms, legs), "
        "or do you only see a dark shadow/blob on the ground with no clear body? "
        "Answer concisely."
    ))
    ap.add_argument("--device", default="cuda:2")  # the 3080 (index 2)
    args = ap.parse_args()

    print("loading Qwen2-VL-2B-Instruct ...", flush=True)
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        "Qwen/Qwen2-VL-2B-Instruct",
        torch_dtype=torch.bfloat16,
        device_map=args.device,
    ).eval()
    processor = AutoProcessor.from_pretrained("Qwen/Qwen2-VL-2B-Instruct")

    img = Image.open(args.image).convert("RGB")
    print(f"image {img.size}, asking model ...", flush=True)
    messages = [{
        "role": "user",
        "content": [{"type": "image", "image": args.image}, {"type": "text", "text": args.question}],
    }]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(images=[img], text=text, return_tensors="pt").to(args.device, torch.bfloat16)
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=256, do_sample=False)
    gen = out[0][inputs["input_ids"].shape[1]:]
    answer = processor.decode(gen, skip_special_tokens=True)
    print("=== VLM ANSWER ===")
    print(answer)


if __name__ == "__main__":
    main()