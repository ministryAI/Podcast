from __future__ import annotations

import os
from pathlib import Path

OLLAMA_URL = os.getenv("OPENPOD_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OPENPOD_OLLAMA_MODEL", "qwen3:8b")
WHISPER_MODEL = os.getenv(
    "OPENPOD_WHISPER_MODEL",
    "mlx-community/whisper-large-v3-turbo",
)
WORK_DIR = Path(os.getenv("OPENPOD_WORK_DIR", str(Path.home() / ".openpod" / "jobs")))
WORK_DIR.mkdir(parents=True, exist_ok=True)

MIN_CLIP_SECONDS = int(os.getenv("OPENPOD_MIN_CLIP_SECONDS", "20"))
MAX_CLIP_SECONDS = int(os.getenv("OPENPOD_MAX_CLIP_SECONDS", "75"))
DEFAULT_CLIP_COUNT = int(os.getenv("OPENPOD_CLIP_COUNT", "5"))
