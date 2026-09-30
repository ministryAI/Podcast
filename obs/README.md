# OBS setup

1. **Settings → Output → Recording:** Type *Standard*, format *Hybrid MP4* (or MKV),
   encoder hardware (NVENC/QuickSync/Apple VT), **Audio Tracks 1–4 ticked**.
2. **Video:** 1920×1080, 30 fps.
3. For each guest, add a **Browser Source** with that guest's OBS link from the studio page:
   1920×1080, ✓ *Control audio via OBS*, ✓ *Shutdown source when not visible* off.
4. **Edit → Advanced Audio Properties:** Tracks: 1 = full mix (everything),
   2 = your mic, 3 = guest 1, 4 = guest 2 … This gives separate tracks for editing
   even without guest-side recording.
5. Scenes: `Intro`, `Solo Host`, `Side by Side`, `Guest Full`, `Outro`.
   Crop/position the browser sources per scene.
6. Export once set up: *Scene Collection → Export* into this folder so it's versioned.

Tip: `obs --startrecording` or the built-in WebSocket server (Tools → WebSocket)
lets you script start/stop later.
