# Developing Blocks

## Project layout

| Location          | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `src/core/`       | Game rules, validation, sessions, statistics, and persistence |
| `src/App.tsx`     | Screens, dialogs, and session orchestration                   |
| `src/components/` | Board, controls, tutorial, settings, and dialogs              |
| `src/audio.ts`    | Synthesized effects, voice limits, mute, and idle suspension  |
| `src/offline.tsx` | Offline readiness and update flow                             |
| `public/`         | Install metadata, icons, and static assets                    |
| `tools/`          | Build, generation audits, and release verification            |
| `tests/`          | Unit and headless browser suites                              |

`src/core/blocks.ts` contains shapes, placement, line clears, and the tray witness checker. `src/core/run.ts` owns scoring, undo milestones, and run state. `src/dealer.ts` manages the reusable worker and rejects stale results.

Game rules are independent of React. Validate each tray witness against placement and line-clearing rules, and preserve saved run, undo, and statistics compatibility when changing the model.

## Checks

Install dependencies with `npm ci`. Run `npm test`, then `npm run build` before browser suites, which serve the built `dist/` directory. Each browser suite starts its own local server and closes it and the browser afterward. No display is required.

```sh
npm test
npm run build
npx playwright install chromium webkit
CHROMIUM_PATH="" npm run test:browser
BROWSER=webkit npm run test:browser
```

Browser tests default to `/usr/bin/chromium`; `CHROMIUM_PATH=""` selects Playwright's downloaded Chromium. `BROWSER=webkit` selects WebKit. On supported Linux distributions, `npx playwright install --with-deps chromium webkit` also installs system libraries.

| Command                    | Checks                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `npm test`                 | Core rules, saves, generation, and audio lifecycle units           |
| `npm run test:browser`     | Actual gameplay, persistence, input, and effects                   |
| `npm run test:layout`      | Phone, tablet, and desktop layout in both themes                   |
| `npm run test:popups`      | Compact dialogs and no-scroll fit                                  |
| `npm run test:feedback`    | Tutorial interactions and feedback styling                         |
| `npm run test:start`       | Start cues, Continue, restart, and mute behavior                   |
| `npm run test:runtime`     | Audio activation and actual effect output                          |
| `npm run test:battery`     | Idle frames, sleeping audio, paused clocks, and background cleanup |
| `npm run test:fullscreen`  | Mobile control, API handling, and install guidance                 |
| `npm run test:release`     | Bounded failure diagnostics for mismatched release bytes           |
| `npm run test:lifecycle`   | Continue, dealer reuse, end-of-run and background transitions      |
| `npm run test:performance` | Input latency, worker reuse, and repeated home/game transitions    |
| `npm run audit`            | Independent Python check of tray witnesses and simulated runs      |

The generation audit requires Python 3 and is a longer-running check.

Run relevant browser suites in both Chromium and WebKit. The workflow in [`.github/workflows/check.yml`](../.github/workflows/check.yml) defines CI checks. WebKit automation covers browser behavior, not exact physical iPhone audio latency, battery use, or status-bar behavior.

Run heavy suites sequentially, especially on a machine used for other tasks. They do not need to run in parallel to provide coverage. Layout checks may create ignored captures under `docs/previews/`. Raw workstation logs under `docs/validation/` are local artifacts; the checked-in [verification record](VERIFICATION.md) summarizes results and known limits.

## Saves, performance, and updates

The app keeps its active game, preferences, and statistics in IndexedDB, with a backup record. Inputs update state immediately. Snapshot cloning and writes are deferred beyond the input handler, with an immediate flush for pause/background/update transitions. Preserve the database name and manifest identity so an upgrade keeps existing saves and the same installed app.

Rendering is driven by input and state changes. Clocks update once a second while playing. Do not add a perpetual animation loop for static screens. The browser controls display refresh; there is no app-wide hardware frame-rate cap. Sound effects have short freshness deadlines and bounded voices; stale sounds are dropped rather than queued.

`npm run build` creates `dist/` and a service worker tied to the built asset bytes. Test the production build when changing worker, caching, or update behavior. Updates save before activation and reload, and must keep offline continuation working.

## Deploy

The existing public origin is **https://blocks-game.pages.dev/**. CI validates source; it does not deploy.

With an authorized local Cloudflare Wrangler login:

```sh
npm run build
# Run the relevant checks above before publishing.
npm run deploy
node tools/verify-live.mjs
BROWSER=webkit node tools/verify-live.mjs
```

`npm run deploy` rebuilds and publishes to the existing Cloudflare Pages project `blocks-game`. The live verifier compares deployed files with local `dist/` bytes, then exercises input, save/reload, and offline continuation. It writes `docs/live-chromium.json` or `docs/live-webkit.json` as a release snapshot. It needs curl in addition to the browser dependencies. Keep these snapshots and [VERIFICATION.md](VERIFICATION.md) in sync with verified releases.

Never commit credentials, personal save data, `node_modules/`, generated builds, or local browser artifacts. The gitignore excludes these paths. [Third-party notices](../THIRD_PARTY_NOTICES.md) cover bundled runtime dependencies.
