#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu/Debian VPS with Docker installed.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Edit deploy/.env then re-run."; exit 1; }
if [ ! -d vdo.ninja ]; then
  git clone --depth 1 https://github.com/steveseguin/vdo.ninja.git
else
  git -C vdo.ninja pull --ff-only
fi
if command -v ufw >/dev/null; then
  ufw allow 80,443/tcp; ufw allow 3478; ufw allow 49160:49200/udp
fi
docker compose up -d
source .env
echo "Studio:   https://$DOMAIN/studio/"
echo "TURN arg: &turn=$TURN_USER;$TURN_PASSWORD;turn:$TURN_DOMAIN:3478"
