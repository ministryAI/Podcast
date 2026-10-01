from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DEFAULT_CLIP_COUNT, WORK_DIR
from .render import render_vertical_clip
from .select import find_clips
from .transcribe import transcribe


def make_shorts(media_path: str | Path, count: int = DEFAULT_CLIP_COUNT) -> dict[str, Any]:
    source = Path(media_path).expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(source)

    job_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = WORK_DIR / f"{source.stem}-{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    transcript = transcribe(source)
    (out_dir / "transcript.json").write_text(json.dumps(transcript, indent=2), encoding="utf-8")

    candidates = find_clips(transcript, count=count)
    rendered: list[dict[str, Any]] = []
    for i, candidate in enumerate(candidates, start=1):
        path = render_vertical_clip(source, candidate, transcript["words"], out_dir, i)
        rendered.append(candidate | {"file": str(path)})

    manifest = {
        "job_id": job_id,
        "source": str(source),
        "model_count_requested": count,
        "clips": rendered,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
