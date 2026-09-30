#!/usr/bin/env bash
# Mix normalized per-guest tracks into one MP3 for publishing.
# Usage: scripts/mixdown.sh out.mp3 host.norm.wav guest1.norm.wav ...
set -euo pipefail
out="$1"; shift
inputs=(); for f in "$@"; do inputs+=(-i "$f"); done
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" \
  -filter_complex "amix=inputs=$#:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 44100 -b:a 128k "$out"
echo "→ $out"
