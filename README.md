# Podcast Studio (self-hosted Riverside alternative)

Remote podcast recording built on **VDO.Ninja** (browser WebRTC for guests) and
**OBS Studio** (mixing, recording, streaming).

```
Guest browser ──WebRTC (P2P, TURN fallback)──▶ Host PC: OBS (one Browser Source per guest)
      │                                                  │
      └─ optional local recording (&record) ─▶ files ─▶ scripts/ post-production
```

## Layout
| Path | What |
|---|---|
| `deploy/` | Docker Compose: Caddy (HTTPS) + self-hosted VDO.Ninja + coturn |
| `site/` | Branded join / director / OBS-link pages |
| `scripts/` | Post-production: loudness normalize, mixdown, transcripts |
| `obs/` | OBS setup notes |
| `docs/` | Episode runbook |

## Live site
**https://ministryai.github.io/podcast/** (the studio link generator)
VDO.Ninja itself is served from **https://ministryai.github.io/podcast/app/**.
Both are deployed by `.github/workflows/pages.yml` on every push and refreshed weekly.

One-time: repo **Settings → Pages → Source: GitHub Actions**.

## Quick start
**Phase 1 – zero cost, no server:** open `site/index.html` locally, keep the
default server `https://vdo.ninja`, generate links, send guest links, paste the
OBS links into Browser Sources. See `docs/runbook.md`.

**Phase 2 – self-host:** see `deploy/README.md`.
