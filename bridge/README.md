# OpenPod Bridge — short-form prototype

This is the first local post-production milestone for the Podcast Studio repo.
It deliberately keeps the architecture small:

```text
podcast.mp4
  -> mlx-whisper (word timestamps, Apple Silicon)
  -> Qwen via local Ollama (editorial clip selection)
  -> deterministic timestamp validation/deduplication
  -> face-aware 9:16 crop
  -> ASS captions
  -> FFmpeg / VideoToolbox MP4 render
```

The model chooses *which ideas are worth clipping*. Code owns timestamps, crop
coordinates, subtitles, files and rendering.

## macOS prerequisites

```bash
brew install ffmpeg
python3 -m venv .venv
source .venv/bin/activate
pip install -r bridge/requirements.txt
```

Run Ollama with a local model (Qwen 8B is the intended starting point):

```bash
ollama pull qwen3:8b
ollama serve
```

If Ollama.app is installed outside PATH, use the full binary path instead.

## Fastest test

From the repository root:

```bash
source .venv/bin/activate
python bridge/run.py /path/to/podcast.mp4 --count 5
```

Outputs land under:

```text
~/.openpod/jobs/<episode>-<timestamp>/
  transcript.json
  manifest.json
  clip_01.mp4
  clip_01.ass
  ...
```

## Run as the local OpenPod Bridge

```bash
uvicorn openpod_bridge.server:app --app-dir bridge --host 127.0.0.1 --port 9876
```

Check:

```bash
curl http://127.0.0.1:9876/health
```

The first API is intentionally simple:

```text
POST /api/shorts/upload?count=5
multipart field: file
```

The GitHub Pages dashboard can call this local bridge in the next iteration.

## Environment variables

- `OPENPOD_OLLAMA_URL` — default `http://127.0.0.1:11434`
- `OPENPOD_OLLAMA_MODEL` — default `qwen3:8b`
- `OPENPOD_WHISPER_MODEL` — default `mlx-community/whisper-large-v3-turbo`
- `OPENPOD_WORK_DIR` — default `~/.openpod/jobs`
- `OPENPOD_MIN_CLIP_SECONDS` — default `20`
- `OPENPOD_MAX_CLIP_SECONDS` — default `75`

## Scope of this prototype

This is not the final OpusClip/Riverside replacement yet. The first goal is to
answer one question with a real episode: can the local machine reliably produce
five *worth reviewing* vertical clips from one long podcast?

Not included yet:

- speaker diarization
- dynamic two-person stacked layout
- semantic pre-segmentation before Qwen
- transcript correction UI
- chat-based editing
- background job queue/progress streaming
- OPFS-to-Bridge handoff from the current recording dashboard

Those come only after the base quality test succeeds.
