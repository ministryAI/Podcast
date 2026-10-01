from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def _ffprobe(path: Path) -> tuple[int, int, float]:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = proc.stdout.strip().splitlines()
    width, height = int(lines[0]), int(lines[1])
    num, den = (lines[2].split("/") + ["1"])[:2]
    fps = float(num) / max(1.0, float(den))
    return width, height, fps


def _median_face_x(path: Path, start: float, end: float, samples: int = 20) -> float | None:
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(str(path))
    centers: list[float] = []
    try:
        for t in np.linspace(start, end, samples):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000.0)
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
            if len(faces):
                x, _y, w, h = max(faces, key=lambda f: f[2] * f[3])
                centers.append(float(x + w / 2))
    finally:
        cap.release()
    return float(np.median(centers)) if centers else None


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _write_ass(words: list[dict[str, Any]], clip_start: float, clip_end: float, out_path: Path) -> None:
    relevant = [w for w in words if float(w["end"]) > clip_start and float(w["start"]) < clip_end]
    groups: list[list[dict[str, Any]]] = []
    group: list[dict[str, Any]] = []
    for word in relevant:
        group.append(word)
        if len(group) >= 4:
            groups.append(group)
            group = []
    if group:
        groups.append(group)

    header = """[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,76,&H00FFFFFF,&H0000FFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,5,0,2,70,70,310,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"""
    lines = [header]
    for g in groups:
        start = max(0.0, float(g[0]["start"]) - clip_start)
        end = min(clip_end - clip_start, float(g[-1]["end"]) - clip_start)
        text = " ".join(str(w["word"]) for w in g).replace("{", "(").replace("}", ")")
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{text}\n")
    out_path.write_text("".join(lines), encoding="utf-8")


def _encoder() -> str:
    try:
        proc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, check=True)
        if "h264_videotoolbox" in proc.stdout:
            return "h264_videotoolbox"
    except Exception:
        pass
    return "libx264"


def render_vertical_clip(
    source: str | Path,
    candidate: dict[str, Any],
    words: list[dict[str, Any]],
    output_dir: str | Path,
    index: int,
) -> Path:
    source = Path(source).expanduser().resolve()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg and ffprobe must be installed and available on PATH")

    start = float(candidate["start"])
    end = float(candidate["end"])
    width, height, _fps = _ffprobe(source)
    target_ratio = 9 / 16
    crop_w = int(round(height * target_ratio))
    if crop_w < width:
        face_x = _median_face_x(source, start, end) or width / 2
        x = int(round(face_x - crop_w / 2))
        x = max(0, min(x, width - crop_w))
        crop = f"crop={crop_w}:{height}:{x}:0"
    else:
        crop_h = int(round(width / target_ratio))
        y = max(0, (height - crop_h) // 2)
        crop = f"crop={width}:{crop_h}:0:{y}"

    ass_path = output_dir / f"clip_{index:02d}.ass"
    _write_ass(words, start, end, ass_path)
    safe_ass = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = f"{crop},scale=1080:1920,ass='{safe_ass}'"

    out_path = output_dir / f"clip_{index:02d}.mp4"
    cmd = [
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
        "-i", str(source), "-vf", vf,
        "-c:v", _encoder(), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path
