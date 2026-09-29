#!/usr/bin/env bash
# tools/sfx-postprocess.sh — turn raw Wan2GP SFX WAVs into tight, loudness-
# matched, mono 44.1k game assets. For each input WAV: strip leading/trailing
# silence (silenceremove), loudness-normalize to a consistent target, downmix to
# mono, resample to 44.1k, and write a compact 16-bit PCM WAV under
# public/assets/audio/sfx/. Mono keeps the WebAudio decode cheap and lets the
# existing _pannerAt routing place each voice in 3D.
#
# Usage: tools/sfx-postprocess.sh <in-dir> [out-dir]
set -euo pipefail
IN="${1:-.research/sfx}"
OUT="${2:-public/assets/audio/sfx}"
mkdir -p "$OUT"
for f in "$IN"/*.wav; do
  [ -e "$f" ] || continue
  name="$(basename "$f" .wav)"
  # -af chain: trim silence from both ends, loudness-normalize, mono, resample.
  # silenceremove start_detection keeps the transient; stop_duration 0.15 trims
  # trailing rumble. loudnorm single-pass is fine for short one-shots.
  ffmpeg -y -hide_banner -loglevel error -i "$f" \
    -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,loudnorm=I=-18:TP=-2:LRA=11,pan=mono|c0=c0,aformat=sample_rates=44100:channel_layouts=mono" \
    -c:a pcm_s16le "$OUT/$name.wav"
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.wav")"
  sz="$(du -h "$OUT/$name.wav" | cut -f1)"
  echo "  $name.wav  ${dur}s  $sz"
done
echo "done -> $OUT"