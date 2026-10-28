# Battery work and preview frame limit - 28 October 2026

The app renders on demand. There is no continuous idle game loop. The browser controls display refresh and CSS animation cadence; this update does not claim a global 60 FPS hardware limit. Gameplay clocks update once per second only while playing. Existing timed checkpoints and lifecycle save flushes remain.

An already-unlocked sound engine ignores silent gestures instead of resuming an idle context or repeatedly extending its idle timeout. Muted/zero-volume/hidden audio remains stopped. Duplicate note aliases share their identical synthesized buffers, reducing preparation and retained audio data. The original voices, sound design and effect deadlines remain. The context suspends 600ms after its last voice finishes, with no truncation; ended-voice cleanup also handles a missed earlier idle check. First trusted activation, delayed start cues and actual PCM after idle pass in both browsers.

Blocks drag/hover previews now use a demand-driven latest-position scheduler targeting at most 60 updates/sec. Unit tests simulate 90/120/144 Hz streams. Final drop coordinates are processed synchronously, canceled/finished gestures leave no frame loop, and no preview work is scheduled on unselected idle hover. The menu no longer constructs an audio context on mount. Previous reusable dealer, post-clear fixes, empty-run cleanup, geometry caching and save scheduling remain.

42 unit tests and the production build passed. Chromium/WebKit gameplay passed (60 Chromium / 55 WebKit), along with real-PCM runtime checks and fresh-start/mute tests. The new npm run test:battery is included in CI: zero app animation-frame callbacks in idle menus/pause, no thinking-time frame loop, fixed paused/hidden clocks, suspended idle audio, no silent-input resume, hidden-worker termination and rejection of late replies/fallback. Save scheduler tests cover post-paint snapshots and immediate flush.

Tests ran headlessly and sequentially on one low-priority core in 2 GiB/no-swap scopes. Evidence: docs/validation/battery-*. No phone energy/temperature or battery-life percentage was measured; desktop WebKit is not a physical iPhone. The battery benefit is reduced unnecessary work, not a measured battery-duration promise.

Production https://blocks-game.pages.dev/; deployment https://0b96615a.blocks-game.pages.dev; offline build `ebc07758426553`. All 12 assets (286,295 bytes) match local bytes. Live Chromium/WebKit input, save/reload and offline continuation passed.

Repository preparation adds a current gameplay screenshot, a player-focused README, a development guide, and exclusions for local logs/builds/caches. Third-party notices were trimmed only at EOF; fresh builds, bounded release-verifier checks, and both live engines passed afterward. No license was chosen for original code.

---

# Run lifecycle and gameplay performance - 28 October 2026

Untouched runs no longer appear as Continue. Returning Home discards an unstarted board without recording a completed run, and old saved unstarted boards are cleaned on load. Progressed runs retain exact board/tray/RNG and the Continue/Discard prompt. Finished runs do not create another run automatically. Saves, statistics and app identity remain compatible.

One reusable worker handles normal refills; requests/responses carry run ID, request ID and revision. Pending work is canceled on pause, Home, modal, undo and new run, and the worker is stopped on background/unmount. Late, mismatched and duplicate results cannot publish trays. Verified cache/undo and the existing fallback are retained. No generator probabilities, scoring or undo-award changes.

Memoized playfield/cells and stable callbacks keep score feedback from redrawing unchanged cells. Drag geometry is read at gesture start and invalidated on layout changes, with a stable resize observer. Move-existence checks short-circuit. Save snapshots wait until after a paint opportunity; lifecycle flushes bypass that wait. Feedback timers are canceled across runs.

The core already checked legal moves after clearing rows/columns; an incorrect mathematical game-over was not reproduced. Added unit/browser regressions for simultaneous row/column clears that expose a remaining legal move and for the last piece clearing then requesting a fresh tray. A genuine final result now waits for the 220ms clear animation (immediate with reduced motion), with the loss cue after the clear. Both app and system reduced-motion settings now omit the clear overlay entirely; previously its disabled animation left opaque cleared blocks visible until the 700ms feedback cleanup. Post-clear placement/refill and late worker responses after pause, Home, background and undo are covered.

Each measurement uses 50 verified tray refills, 149 input placements and 10 Home/Continue cycles on this Linux workstation, mobile viewport/touch input, one low-priority core. Placements remained visible within the first two animation frames. After-update checks also verify constant global listener counts, one playtime interval and bounded transient timers. The baseline did not instrument resource counters beyond workers; these timings are desktop browser measurements, not physical iPhone performance. WebKit long-task reporting is unavailable.

| Engine | Worker creations | Placement-handler p95 | Refill median | Refill p95 |
| --- | --- | --- | --- | --- |
| chromium | 50 -> 1 | 3.4 -> 1.0 ms | 15.8 -> 15.5 ms | 18.5 -> 16.5 ms |
| webkit | 50 -> 1 | 4.0 -> 1.0 ms | 30.0 -> 2.0 ms | 41.0 -> 4.0 ms |

37 unit tests and production build passed. Chromium/WebKit: 60/55 gameplay checks, 146/146 layout checks, startup cues, 11/11 audio checks, new lifecycle scenarios and 50-refill performance checks. Actual service-worker upgrade/save preservation and bounded release-verifier checks passed. CI includes test:lifecycle and test:performance. Logs/measurements: docs/validation/optimization-*. Headless jobs ran sequentially on one low-priority core inside 2 GiB/no-swap scopes. Physical iPhone acceptance remains outstanding.

Production https://blocks-game.pages.dev/; deployment https://70a60ea0.blocks-game.pages.dev; offline build `9d474e15de99c0`. All 12 assets (285,660 bytes) match local bytes. Chromium/WebKit live move/save/reload/offline verification passed.

---

# Pause menu button spacing - 24 October 2026

Blocks pause menu buttons now have a 12px gap between each consecutive action, improving separation without changing the dialog or button behavior. Production build `99a47f7e356817` passed; deployment https://64d9c81e.blocks-game.pages.dev is live at https://blocks-game.pages.dev. Chromium and WebKit live asset, move, save/reload and offline continuation verification passed. Logs: docs/validation/pause-padding-*.log.

---

# Immersive fullscreen request correction - 21 October 2026

The fullscreen button now attempts the standard/prefixed Fullscreen API before considering manifest display mode. An installed app reporting display-mode:fullscreen is not proof that device status bars are hidden. Removed the misleading already-fullscreen dialog and Fullscreen options label; Enter fullscreen stays actionable unless an actual API fullscreen element exists. Unsupported installed browsers explain the status-bar limitation; rejected requests no longer advise reopening the same installed app. Home Screen launch metadata and safe-area layout are unchanged.

All 74 units and three builds passed. Each app passes seven fullscreen scenarios in Chromium and WebKit, including the new installed+API-supported regression: a real request call with navigationUI:hide, state/label update and exit are required even with display-mode:fullscreen. Other cases cover prefixed API, unsupported/standalone/installed devices, denied requests, mobile placement, theme persistence and no-scroll dialog fit. Tests use simulated platform states; they do not establish that physical Android/iOS system bars disappear. Logs: validation/immersive-*.log. Checks remained headless, sequential, one low-priority core in separate 2 GiB/no-swap scopes.

Production https://blocks-game.pages.dev/; deployment https://c879c992.blocks-game.pages.dev; offline build `c547c7766dd89e`. All 12 published files (283,053 bytes) match local bytes. Live Chromium/WebKit input, save/reload and offline continuation passed.

---

# Home Screen fullscreen and mobile control - 21 October 2026

Fullscreen control remains visible beside Settings on phones/tablets and desktop, instead of disappearing when Fullscreen API is unavailable. A local independent component handles standard and prefixed enter/exit, installed-fullscreen status, mode changes, denied requests and a compact Home Screen guidance dialog. Installed fullscreen is controlled by the manifest, with no automatic gesture-restricted API calls at startup. iOS boot and runtime status-bar metadata consistently use black-translucent with existing viewport-fit=cover and safe-area padding; device status indicators may remain. Existing identities, storage and saves are preserved.

74 unit tests and production builds passed across the three apps. Each app passes six focused fullscreen scenarios in Chromium and WebKit: standard/prefixed enter/exit, unsupported phones, standalone Home Screen launch, installed fullscreen and denied requests. Checks assert button placement beside Settings, no startup request, launch metadata, theme persistence, compact no-scroll guidance and no browser errors. Existing Chromium/WebKit gameplay suites passed (Blocks 60/55, Nonogram 38/38, Number Sums 54/54). New npm run test:fullscreen is included in CI. Logs: validation/fullscreen-*.log. Heavy checks remained headless, sequential, one low-priority core and separate 2 GiB/no-swap scopes. Physical iOS status-bar behavior is not established by desktop WebKit simulations.

Production https://blocks-game.pages.dev/; deployment https://2e9a09c9.blocks-game.pages.dev; offline build `29444cb3d71c04`. All 12 files (283,111 bytes) match local build bytes. Live Chromium/WebKit save/reload, accepted input and offline continuation passed.

---

# New-game button spacing - 21 October 2026

Blocks new-game confirmation now has a 12px gap between Continue run and Discard and start anew. Production build and compact confirmation/start-flow tests passed in Chromium and WebKit. Published https://a02016ae.blocks-game.pages.dev, offline build `18652ea8bdcb7d`; both live asset/save/reload/offline verifiers passed. Evidence: docs/validation/dialog-spacing-*.log. Headless sequential checks; no other game changes.

---

# Gameplay alignment and action styling - 21 October 2026

Pause New game and the new-run confirmation discard action now use the existing theme secondary filled surface. Resume and Continue run retain primary emphasis; labels and run behavior are unchanged.

Validation: Tests  28 passed (28); 60 chromium checks passed; 55 webkit checks passed; 146 chromium layout checks passed; 146 webkit layout checks passed. Startup/restart sound-flow checks passed in both engines. Nonogram's layout suite also asserts mode-switch left/right edges match the playable cells across all sizes, themes and rule modes. Logs: `validation/alignment-*.log`. Reviewed headless gameplay captures; no visible testing. Checks ran sequentially on one low-priority core in separate 2 GiB/no-swap scopes.

Production https://blocks-game.pages.dev/; deployment https://154b3eb5.blocks-game.pages.dev, offline build `468f16e85b28ca`. All 12 published files (281,692 bytes) match local bytes. Live Chromium/WebKit checks passed for input, save/reload and offline continuation.

---

# Tutorial, new-run prompt and sound update - 20 October 2026

Tutorial practice is tap-only: select the piece below the board, then tap an outlined gap. Drag handlers/ghost/cursor were removed from the tutorial; full-board row-clearing and actual gameplay dragging remain intact. New game asks about every unfinished run, including one with no moves: primary Continue run resumes it; Discard and start anew finishes the old run under the existing statistics rules and starts a zero-score run. Finished runs skip the prompt. The start chime waits for the initial verified tray to be accepted; a pending run ID is consumed once, so later deals and Continue do not replay it. Blocks uses a warm C-major start pluck with a soft second harmonic (523/659/784 Hz, 310 ms).

All new cues use the existing Sound effects preference and volume. Startup/error notes have short attack/release envelopes and end at zero. The bounded single AudioContext/buffer engine retains its deadline, repeat coalescing, four-voice limit, background cancellation and idle suspension. No music, asset downloads or continuous audio loops were added. Loss and correct-choice cues are unchanged; the distinct error pattern applies to Number Sums and Nonogram.

Unit/build, gameplay and audio/runtime checks passed in Chromium/WebKit. Permanent `npm run test:start`, included in CI, checks one real startup buffer per fresh attempt, silence on Continue, primary Continue/discard at 320x568, fresh IDs/reset score, and mute/zero-volume behavior. Blocks additionally delays the first worker deal by one second to reject premature playback, and passes tap-only tutorial fit/input checks at compact/phone/desktop sizes in both themes. Puzzle restart cues are checked once; real mistake/loss buffers remain distinct in the gameplay suites. Evidence: `validation/start-*.log`. Full gameplay counts remain Blocks 60 Chromium/55 WebKit, Number Sums 54/54 and Nonogram 38/38; 74 unit tests total, 11 audio runtime checks per game/engine.

Latest production: https://blocks-game.pages.dev/; deployment `a0405cd4`, offline build `4f233ec56deec7`. All 12 files (281,696 bytes) match local assets; live Chromium/WebKit save/reload/offline continuation passed. All heavy jobs were headless, sequential, one low-priority core and separate 2 GiB/no-swap scopes. Browser/server cleanup was verified. Physical-device audibility remains separate from automated buffer/PCM checks.

---

# Gameplay text cleanup - 20 October 2026

The repeated drag/select instructions below the piece tray are removed. Placement/invalid-placement/dealing announcements remain in a screen-reader-only live status without reserving visible height. The fixed tray and score allocation still prevent board jumps. Menus, dialogs, gameplay labels, clues and numbers cannot be selected by mouse dragging or long press. Body-level standard/WebKit selection suppression and iOS callout suppression apply throughout the interface; editable controls keep their normal behavior. No game rules, saves or difficulty behavior changed.

Unit/build and Chromium/WebKit gameplay suites passed. Focused headless checks exercised actual text-selection drags on menu headings and game metadata, checked volume editing, absence of hint rows and layout fit at 320x568, 430x932 and 1920x1080 in both themes. Captures were reviewed. Blocks' tall-piece/score/undo placement regression still passes immediately and after feedback fades. Evidence: `validation/selection-*.log`; captures in ignored `previews/selection-*`. The temporary visual fixture was removed after validation. Earlier broader checks remain below.

Latest production: https://blocks-game.pages.dev/; deployment `205ed497`, offline build `b57c52690f6b47`. All 12 files (282,607 bytes) match local assets; live Chromium/WebKit save/reload/offline continuation passed. Every heavy job was headless, sequential, one low-priority core, separate 2 GiB/no-swap scope. Browsers and servers were closed.

---

# Tutorial and feedback verification - 20 October 2026

The practice piece is below the board and accepts both dragging and select/tap input. The second lesson uses a five-by-five board with a partly filled row, outlined missing squares and a clear that leaves unrelated blocks in place. Slide three and Play start/resume behavior are preserved. Home in Pause saves the run for Continue. Visible text uses regular hyphens. Existing centered compositions, single settings/statistics popups, saves and app identities are preserved.

## Checks

- Unit tests: 28 passed (`validation/feedback-unit.log`). Production build passed.
- Gameplay: 60 Chromium / 55 WebKit checks passed (`validation/feedback-*-browser.log`). Includes saved-game navigation, offline continuation and accepted input feedback.
- Layout: 146 Chromium / 146 WebKit checks passed (`validation/feedback-*-layout.log`), phone/tablet/desktop through 4K, both themes.
- `npm run test:feedback` passed in both engines: compact 320x568, phone 430x932, desktop 1920x1080, both themes. Checks rounded inset difficulty rows or tutorial fit and input. Blocks also covers outside-drop cancellation and native touch drag in Chromium, plus select/tap input and mouse drag in both engines.
- `npm run test:popups` passed in both engines. Settings and statistics remain visible together without scrolling at 320x568.
- Safe release-verifier regression and application audit passed. Evidence: `validation/feedback-release-safety.log`, `validation/feedback-audit.log`.
- Tutorial tests reject occupied squares, accept a dragged piece into the row gaps and start a playable run. Short-screen spacing was reduced after a real 320x568 clipping failure; the corrected pages pass without scrolling.

All tests run headlessly, sequentially, on one low-priority core inside separate 2 GiB/no-swap user scopes. Browsers and servers close in finally. Automated WebKit does not establish physical iPhone rendering, audibility, latency or temperature.

## Published release

- Production: https://blocks-game.pages.dev/
- Deployment: `504328c8`; offline build: `eb572ad6d14fa2`.
- Full offline payload: 282,811 bytes across 12 files.
- All deployed assets match local bytes. Chromium/WebKit both accepted a move, changed theme, reloaded saves and continued offline. Evidence: `live-chromium.json`, `live-webkit.json`, `validation/feedback-live-*.log`.
- No music, generator changes, database renaming or GitHub publication.
