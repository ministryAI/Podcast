from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import WHISPER_MODEL


def transcribe(media_path: str | Path) -> dict[str, Any]:
    """Transcribe media with mlx-whisper and return word-level timing data."""
    try:
        import mlx_whisper
    except ImportError as exc:
        raise RuntimeError(
            "mlx-whisper is not installed. Run: pip install mlx-whisper"
        ) from exc

    result = mlx_whisper.transcribe(
        str(Path(media_path).expanduser().resolve()),
        path_or_hf_repo=WHISPER_MODEL,
        word_timestamps=True,
        condition_on_previous_text=False,
    )

    words: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    for seg in result.get("segments", []):
        segment = {
            "start": float(seg.get("start", 0.0)),
            "end": float(seg.get("end", 0.0)),
            "text": str(seg.get("text", "")).strip(),
        }
        segments.append(segment)
        for word in seg.get("words", []) or []:
            text = str(word.get("word", "")).strip()
            if not text:
                continue
            words.append(
                {
                    "start": float(word.get("start", segment["start"])),
                    "end": float(word.get("end", segment["end"])),
                    "word": text,
                    "probability": float(word.get("probability", 1.0)),
                }
            )

    duration = 0.0
    if words:
        duration = words[-1]["end"]
    elif segments:
        duration = segments[-1]["end"]

    return {
        "language": result.get("language", "unknown"),
        "duration": duration,
        "segments": segments,
        "words": words,
    }
