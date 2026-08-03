# Night phase narration

`night_narration_audio/` holds the recorded narration clips `nightNarration.js` plays during the night phase. `night_narration_audio/durations.json` is a probed cache of each clip's playback length — it's what lets the app estimate the night phase's real duration (for the sidebar's Night row and the Q1–Q5/Assassination time budget) without loading every clip up front.

**Whenever you add, remove, or re-record a clip, regenerate `durations.json`:**

```bash
npm run build-durations
```

(Needs `ffprobe` — part of ffmpeg: `brew install ffmpeg`.)

If you forget, nothing crashes — clips missing from `durations.json` just fall back to a flat 3s estimate, which will throw off the night-time projection.
