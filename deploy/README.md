# Self-hosting

Needs: a small VPS (1 vCPU / 1 GB is plenty; media is P2P and doesn't pass through it
unless TURN is needed), Docker, a domain with two A records (`DOMAIN`, `TURN_DOMAIN`).

```bash
git clone <this repo> && cd Podcast/deploy
./setup.sh          # creates .env on first run – edit it, then run again
```

- `https://DOMAIN/`        → your own VDO.Ninja copy
- `https://DOMAIN/studio/` → branded link generator / join page
- coturn on UDP/TCP 3478, relay ports 49160-49200/udp

**Signaling:** the self-hosted VDO.Ninja still uses the public handshake server
(`wss.vdo.ninja`) to introduce peers. It carries no media. Fully self-hosting
signaling is possible later (see the VDO.Ninja docs on custom handshake servers).

**Update VDO.Ninja:** re-run `./setup.sh`.
