from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

import requests
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import OLLAMA_MODEL, OLLAMA_URL, WORK_DIR
from .pipeline import make_shorts

app = FastAPI(title="OpenPod Bridge", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://127.0.0.1", "https://ministryai.github.io"],
    allow_origin_regex=r"https://ministryai\.github\.io(:\d+)?$|http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    ollama_ok = False
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        ollama_ok = r.ok
    except requests.RequestException:
        pass
    return {
        "ok": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ollama": ollama_ok,
        "ollama_model": OLLAMA_MODEL,
    }


@app.post("/api/shorts/upload")
def shorts_upload(file: UploadFile = File(...), count: int = 5) -> dict:
    suffix = Path(file.filename or "episode.mp4").suffix or ".mp4"
    upload_dir = WORK_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{uuid4().hex}{suffix}"
    try:
        with target.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        return make_shorts(target, count=max(1, min(12, count)))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
