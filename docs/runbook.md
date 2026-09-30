# Episode runbook

## Before (day before)
- [ ] Open the studio page, set room/password, list guests, **Generate links**.
- [ ] Send each guest their link along with this:
  > Use Chrome or Edge on a laptop, **wear headphones**, plug into ethernet if you can,
  > close other apps. When recording finishes, keep the tab open until your file finishes downloading,
  > then send it to me (Drive/Dropbox link).
- [ ] Load the OBS links into the Browser Sources.

## During
1. Open the director link. Check each guest's audio/video there.
2. Guests with `&record` record on their side. Start it from the director room
   (per-guest "Record" button) or ask them to press it.
3. Hit **Start Recording** in OBS as the safety net.
4. Clap on camera at the start (sync point).

## After
1. Stop OBS, stop the guest recordings, collect the guest files into `recordings/epNN/`.
2. `scripts/normalize.sh recordings/epNN/*`
3. Edit/sync in your editor (Audacity/Reaper/DaVinci). Line up the clap.
4. `scripts/mixdown.sh epNN.mp3 recordings/epNN/*.norm.wav` (if no edit is needed)
5. `scripts/transcribe.sh epNN.mp3` for show notes and captions.
