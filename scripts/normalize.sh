#!/usr/bin/env bash
# Loudness-normalize each file to podcast standard (-16 LUFS, -1.5 dBTP) as 48k WAV.
# Usage: scripts/normalize.sh recordings/ep01/*.{webm,mkv,wav}
set -euo pipefail
for f in "$@"; do
  out="${f%.*}.norm.wav"
  echo "→ $out"
  ffmpeg -hide_banner -loglevel error -y -i "$f" -vn \
    -af "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 "$out"
done
