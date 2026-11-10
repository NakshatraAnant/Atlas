# ATLAS walkthrough: recording notes

**Status: recorded and verified, 11 Nov 2026 (take 5).**

## Files

| File | What it is | In git? |
|---|---|---|
| `artifacts/ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4` | The narrated screen recording | No (git-ignored: 92.6 MB) |
| `artifacts/ATLAS_WALKTHROUGH_SCRIPT.md` | Narration and on-screen content, scene by scene, with timings | Yes |
| `artifacts/ATLAS_WALKTHROUGH.srt` | English captions, 76 cues (also burned into the video) | Yes |
| `artifacts/walkthrough-frames/` | 20 frames sampled by the verifier | No (git-ignored) |

## How it was made

- **Real app.** `scripts/walkthrough/record.mts` drives Microsoft Edge (Playwright) through the running local build at http://localhost:3000, signed in as the development Pro account (`pro@atlas.test`). Real-data mode. No mock data, no edited screens.
- **Capture.** The Chrome DevTools screencast streams JPEG frames, 1280×720.
- **Narration.** Windows speech (Microsoft Zira Desktop) synthesises the narration offline. **The voice is synthetic**, and the opening title card and narration say so.
- **Composition.** In Edge: canvas plus MediaRecorder, H.264 video with AAC audio in MP4. Captions and a chapter label are burned in.
- **Not shown:** API keys or secrets, personal information, developer tools, console errors, and incomplete administrator screens. The operator console is not part of the tour.

## Contents (5 min 44 s)

1. Title card: what ATLAS is, the local build, the synthetic voice.
2. Home, including the first-run welcome steps and "What changed".
3. Search: Ctrl+K, "rupee", and "gold", which is stated as not available.
4. Macro series: provenance and the interactive chart (ranges, hover, drag-zoom).
5. Following a series.
6. Relationship explorer: Brent against NIFTY 50.
7. Commodities.
8. Indian indices.
9. Digital assets.
10. A hypothetical portfolio review.
11. A walk-forward backtest.
12. Notebook and reports.
13. Academy, progress, and a lesson video with captions.
14. Notifications.
15. Settings.
16. Data sources.
17. A phone-width view.
18. Closing card: known limits.

## Verification (actual results)

| Check | Result |
|---|---|
| Container | MP4 (`isom`), H.264 `avc1.64001f` + AAC `mp4a.40.2` |
| Size | 92,618,927 bytes |
| Duration | 345.54 s as played in Edge, against 344.12 s expected from the timeline (+1.4 s encoder tail) |
| Resolution | 1280×720 |
| Frames captured | 4,537 screencast frames over 18 app scenes |
| Picture | 20 sampled frames, one per chapter plus start and end. Mean brightness 15–33 (dark theme): none black, none blank. Inspected by eye: search palette, macro chart with hover, portfolio review, chapter label clear of the header |
| Sound | Whole soundtrack decoded in Edge: 344.3 s, stereo, mean RMS 0.084. Within the 331 seconds covered by captions, 22 isolated seconds are quiet (at most 2 in a row): pauses between sentences and scenes, not missing narration |
| Captions | 76 cues in the SRT, matching the burned-in captions |
| Scene actions | 18/18 scenes ran, with no "not found" selectors and no action errors |
| Console | 0 browser console errors during the tour |

The picture and container checks are stored in `.atlas/walkthrough-work/verify.json`. The soundtrack check can be re-run at any time without changing the video: `npx tsx scripts/walkthrough/verify-audio.mts`. (Do not use `record.mts --skip-tour` for checking: it re-composes and overwrites the MP4.)

## Takes, and why the earlier ones were rejected

| Take | Date | Outcome |
|---|---|---|
| 1 | 5 Nov | Rejected. Pages stalled 20–35 s while the macro scene recorded. Cause: the crypto scheduler query (fixed, bug 5). Kept locally as `.atlas/walkthrough-take1-stalled.mp4` |
| 2 | 5 Nov | Abandoned during capture. The machine slept for 2.6 hours inside one scene; the recorder now stops a take when a scene runs over 180 s |
| 3 | 5 Nov | Rejected. Home showed "Recent changes could not be loaded" (bug 7), Ctrl+K did not open (bug 8), and the chapter label covered the header buttons. Kept as `.atlas/walkthrough-take3-rejected.mp4` |
| 4 | 11 Nov | Clean (one expected 401 at sign-in), but recorded before the welcome tour, the chart unification and the ninth course video. Superseded |
| 5 | 11 Nov | **Final.** All 18 scenes, 0 console errors |

## Known differences from the current build

- **Macro series page:** the "Retrieved by ATLAS" card shows `11/11/2026`. After the recording it was changed to ISO format (`2026-11-11`) to match the other dates on the page. Nothing else on screen differs.
- **Data:** the data shown is as of 11 Nov 2026, about 01:55–02:20 IST. Indian indices end on 9 Nov and are marked as due, because the 10 Nov end-of-day row had not arrived; the 08:00 IST refresh retries it.
