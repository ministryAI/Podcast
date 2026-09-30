#!/usr/bin/env bash
# Transcribe with local Whisper (pip install openai-whisper). Outputs .srt/.txt/.vtt.
# Usage: scripts/transcribe.sh episode.mp3 [model]
set -euo pipefail
whisper "$1" --model "${2:-small}" --language en --output_format all --output_dir "$(dirname "$1")"
