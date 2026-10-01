from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Any

import requests

from .config import MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, OLLAMA_MODEL, OLLAMA_URL


@dataclass
class ClipCandidate:
    start: float
    end: float
    score: int
    title: str
    hook: str
    reason: str

    @property
    def duration(self) -> float:
        return self.end - self.start


_SYSTEM = """You are the editorial producer for a thoughtful long-form podcast.
Find moments that work as standalone vertical short-form clips.

Prefer moments that have:
- a strong opening claim, question, tension, story, or surprising idea
- enough context to make sense without the full episode
- a clear payoff or landing point
- substance, not empty clickbait

Return only JSON in this shape:
{"clips":[{"start":12.3,"end":54.2,"score":88,"title":"Short title","hook":"opening idea","reason":"why this stands alone"}]}

Timestamps must be seconds from the supplied transcript. Do not invent content.
"""


def _chunk_words(words: list[dict[str, Any]], target: float = 210.0, overlap: float = 30.0) -> list[list[dict[str, Any]]]:
    if not words:
        return []
    total = float(words[-1]["end"])
    step = max(30.0, target - overlap)
    chunks: list[list[dict[str, Any]]] = []
    start = 0.0
    while start < total:
        end = start + target
        chunk = [w for w in words if start <= float(w["start"]) < end]
        if chunk:
            chunks.append(chunk)
        start += step
    return chunks


def _timestamped_text(words: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    bucket: list[str] = []
    bucket_start = float(words[0]["start"]) if words else 0.0
    last_end = bucket_start
    for word in words:
        bucket.append(str(word["word"]))
        last_end = float(word["end"])
        if last_end - bucket_start >= 6.0:
            lines.append(f"[{bucket_start:.1f}-{last_end:.1f}] {' '.join(bucket)}")
            bucket = []
            bucket_start = last_end
    if bucket:
        lines.append(f"[{bucket_start:.1f}-{last_end:.1f}] {' '.join(bucket)}")
    return "\n".join(lines)


def _extract_json(text: str) -> dict[str, Any]:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {"clips": value}
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.S)
    if not match:
        return {"clips": []}
    try:
        value = json.loads(match.group(0))
        return value if isinstance(value, dict) else {"clips": []}
    except json.JSONDecodeError:
        return {"clips": []}


def _ollama_pick(chunk: list[dict[str, Any]]) -> list[ClipCandidate]:
    if len(chunk) < 25:
        return []
    prompt = (
        f"Choose up to 4 strong clips. Each must be {MIN_CLIP_SECONDS}-{MAX_CLIP_SECONDS} seconds. "
        "Favor complete ideas over forced virality.\n\nTRANSCRIPT:\n"
        + _timestamped_text(chunk)
    )
    response = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "options": {"temperature": 0.2, "num_ctx": 8192},
        },
        timeout=600,
    )
    response.raise_for_status()
    content = response.json().get("message", {}).get("content", "")
    data = _extract_json(content)

    low = float(chunk[0]["start"])
    high = float(chunk[-1]["end"])
    out: list[ClipCandidate] = []
    for raw in data.get("clips", []) or []:
        if not isinstance(raw, dict):
            continue
        try:
            start = max(low, float(raw["start"]))
            end = min(high, float(raw["end"]))
            score = int(float(raw.get("score", 0)))
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        duration = end - start
        if duration < MIN_CLIP_SECONDS or duration > MAX_CLIP_SECONDS:
            continue
        out.append(
            ClipCandidate(
                start=start,
                end=end,
                score=max(0, min(100, score)),
                title=str(raw.get("title", "Untitled clip"))[:80],
                hook=str(raw.get("hook", ""))[:200],
                reason=str(raw.get("reason", ""))[:300],
            )
        )
    return out


def _dedupe(candidates: list[ClipCandidate]) -> list[ClipCandidate]:
    selected: list[ClipCandidate] = []
    for candidate in sorted(candidates, key=lambda c: c.score, reverse=True):
        overlap = False
        for existing in selected:
            inter = max(0.0, min(candidate.end, existing.end) - max(candidate.start, existing.start))
            smaller = min(candidate.duration, existing.duration)
            if smaller and inter / smaller >= 0.55:
                overlap = True
                break
        if not overlap:
            selected.append(candidate)
    return selected


def find_clips(transcript: dict[str, Any], count: int = 5) -> list[dict[str, Any]]:
    words = transcript.get("words", [])
    candidates: list[ClipCandidate] = []
    # Deliberately sequential: a single local Ollama model on 16GB unified memory
    # generally behaves better than several concurrent generations.
    for chunk in _chunk_words(words):
        candidates.extend(_ollama_pick(chunk))
    return [asdict(c) | {"duration": round(c.duration, 2)} for c in _dedupe(candidates)[:count]]
