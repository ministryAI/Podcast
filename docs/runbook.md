# Episode runbook

## Before (day before)
- [ ] Open the studio page, set room/password, list guests, **Generate links**.
- [ ] Send each guest their link along with this:
  > Use Chrome or Edge on a laptop, **wear headphones**, plug into ethernet if you can,
  > close other apps. After we stop recording, keep the tab open until it says "Sent to host".
- [ ] Load the OBS links into the Browser Sources.

## During
1. Open the director link. Check each guest's audio/video there.
2. Hit **Record** in the studio. Everyone records locally, and guest files stream to you live.
3. (Optional) Also record in OBS as a safety net.
4. Clap on camera at the start (sync point).

## After
1. Stop, wait for every guest to show ✓ on the leave screen, then open the recording in the dashboard and **Export** the tracks into `recordings/epNN/`.
2. `scripts/normalize.sh recordings/epNN/*`
3. Edit/sync in your editor (Audacity/Reaper/DaVinci). Line up the clap.
4. `scripts/mixdown.sh epNN.mp3 recordings/epNN/*.norm.wav` (if no edit is needed)
5. `scripts/transcribe.sh epNN.mp3` for show notes and captions.
