import assert from "node:assert/strict";
import {
  harness,
  fit,
  instrumentInput,
  instrumentEffects,
} from "./support.mjs";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
await build({
  entryPoints: ["src/core/blocks.ts", "src/core/run.ts", "src/core/profile.ts"],
  outdir: "/tmp/blocks-browser",
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
});
const core = await import("/tmp/blocks-browser/blocks.mjs"),
  run = await import("/tmp/blocks-browser/run.mjs"),
  profile = await import("/tmp/blocks-browser/profile.mjs");
const h = await harness(),
  { browser, engine, base } = h;
const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let checks = 0;
const check = (ok, label) => {
  assert.ok(ok, label);
  checks++;
  console.log("PASS", label);
};
await context.addInitScript(instrumentInput);
await context.addInitScript(instrumentEffects);
await page.addInitScript(() => {
  window.testVoices = [];
  window.testMeters = [];
  const Original = window.Audio;
  window.Audio = function () {
    const a = new Original();
    window.testVoices.push(a);
    return a;
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    if (args[0] === this.context.destination) {
      const a = this.context.createAnalyser();
      a.fftSize = 256;
      connect.call(this, a);
      connect.call(a, this.context.destination);
      window.testMeters.push(a);
      return args[0];
    }
    return connect.apply(this, args);
  };
});
async function read() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("blocks-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("profile").objectStore("profile").get("current");
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
        };
      }),
  );
}
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    const p = await read();
    if (p && fn(p)) return p;
    await page.waitForTimeout(25);
  }
  throw Error("Timed out waiting for saved profile");
}
async function write(p) {
  assert.ok(profile.validateProfile(p), "test fixture is valid");
  if (await page.getByRole("button", { name: "Menu", exact: true }).count())
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.waitForTimeout(50);
  await page.evaluate(
    (p) =>
      new Promise((resolve) => {
        const r = indexedDB.open("blocks-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("profile", "readwrite");
          tx.objectStore("profile").put(p, "current");
          tx.objectStore("profile").put(p, "backup");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    p,
  );
  await page.reload();
  await page.getByRole("heading", { name: "Blocks", exact: true }).waitFor();
  if (p.active && !p.active.counted)
    await page.getByRole("button", { name: /^Continue/ }).tap();
  await page.waitForTimeout(80);
}
const single = core.SHAPES.find((s) => s.count === 1),
  horizontal = core.SHAPES.find((s) => s.count === 2 && s.width === 2);
const piece = (shape = single, color = 1) => ({ shape: shape.id, color });
function fixture() {
  const p = profile.freshProfile();
  p.preferences.reduceMotion = true;
  p.active = run.newRun(1234);
  p.active.tray = [piece(), piece(horizontal, 2), piece(single, 3)];
  p.active.phase = "playing";
  p.active.moves = 1;
  return p;
}
async function tapPlace(slot, index) {
  await page.locator(`[data-slot="${slot}"]`).tap();
  await page.locator(`[data-cell="${index}"]`).tap();
}
async function rms() {
  return page.evaluate(() =>
    Math.max(
      0,
      ...window.testMeters.map((m) => {
        const d = new Float32Array(m.fftSize);
        m.getFloatTimeDomainData(d);
        return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
      }),
    ),
  );
}
async function checkSound(label) {
  let v = 0;
  for (let i = 0; i < 100; i++) {
    v = Math.max(v, await rms());
    if (v > 0.00005) break;
    await page.waitForTimeout(80);
  }
  if (v <= 0.00005)
    console.log(
      "AUDIO DEBUG",
      await page.evaluate(() => ({
        status: document.querySelector(".track-title")?.textContent,
        meters: window.testMeters.map((m) => ({
          state: m.context.state,
          time: m.context.currentTime,
        })),
        voices: window.testVoices.map((a) => ({
          src: a.getAttribute("src"),
          paused: a.paused,
          time: a.currentTime,
          ready: a.readyState,
          error: a.error?.message,
        })),
      })),
    );
  check(v > 0.00005, label);
}
async function noOverflow(label) {
  // WebKit applies emulated viewport changes asynchronously. Let its layout and
  // ResizeObserver settle before asserting, without relying on app clock renders.
  await page
    .waitForFunction(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
      null,
      { timeout: 3000 },
    )
    .catch(async () => {
      console.log(
        "LAYOUT DEBUG",
        await page.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          outside: [...document.querySelectorAll("body *")]
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            }))
            .filter((r) => r.right > innerWidth + 1 || r.left < -1)
            .slice(0, 12),
        })),
      );
    });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    label,
  );
}
mkdirSync("docs/previews", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Blocks", exact: true }).waitFor();
  await page
    .getByText("Ready offline", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.waitForTimeout(300);
  check(true, engine + " startup and complete offline cache");
  await page.screenshot({ path: `docs/previews/${engine}-home.png` });
  await page.getByRole("button", { name: "How to play", exact: true }).tap();
  const demoBoard = page.locator(".practice-board"),
    demoPiece = page.getByRole("button", { name: "Select practice piece" });
  const demoRect = await demoBoard.boundingBox(),
    trayRect = await demoPiece.boundingBox();
  check(
    trayRect.y >= demoRect.y + demoRect.height,
    "tutorial piece sits below the board",
  );
  await demoPiece.tap();
  await page
    .getByRole("button", { name: "Practice square 1, occupied", exact: true })
    .tap();
  check(
    !(await page.getByText("Piece placed!", { exact: false }).count()),
    "tutorial rejects an occupied square",
  );
  await page
    .getByRole("button", { name: "Practice square 6", exact: true })
    .tap();
  await page.getByText("Piece placed!", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  check(
    (await page.locator(".practice-board button").count()) === 25,
    "line lesson shows a complete board",
  );
  await demoPiece.tap();
  await page
    .getByRole("button", { name: "Practice square 14", exact: true })
    .tap();
  await page.getByText("Line cleared!", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  await until(
    (p) => p.preferences.tutorialSeen && p.active?.phase === "playing",
  );
  check(true, "interactive tutorial clears its row and starts a playable game");
  const stable = fixture();
  const tall = core.SHAPES.find((s) => s.height === 5);
  stable.active.tray = [piece(tall), piece(), piece()];
  stable.active.score = 9990;
  stable.active.highwater = 9990;
  await write(stable);
  const boardBefore = await page.locator(".block-board").boundingBox();
  await tapPlace(0, 0);
  await until((p) => p.active.moves === 2);
  for (const wait of [0, 750]) {
    if (wait) await page.waitForTimeout(wait);
    const rect = await page.locator(".block-board").boundingBox();
    check(
      Math.abs(rect.y - boardBefore.y) < 1 &&
        Math.abs(rect.height - boardBefore.height) < 1,
      "board stays fixed after tall piece, score/undo feedback " + wait + "ms",
    );
  }
  await write(fixture());
  const tutorialRunId = (await read()).active.id;
  await page.getByRole("button", { name: "Pause game" }).tap();
  await page.getByRole("button", { name: "Home", exact: true }).tap();
  await page.getByRole("heading", { name: "Blocks", exact: true }).waitFor();
  await page.getByRole("button", { name: /Continue/ }).tap();
  check(
    (await read()).active.id === tutorialRunId,
    "pause Home and Continue preserve the run",
  );
  await page.getByRole("button", { name: "Pause game" }).tap();
  await page.getByRole("button", { name: "How to play", exact: true }).tap();
  await page.getByRole("button", { name: "Close dialog" }).tap();
  check(
    await page.getByRole("button", { name: "Resume", exact: true }).isVisible(),
    "closing tutorial preserves paused run",
  );
  async function tutorialPlay() {
    await page.getByRole("button", { name: "How to play", exact: true }).tap();
    for (let i = 0; i < 2; i++)
      await page.getByRole("button", { name: "Next", exact: true }).tap();
    await page.getByRole("button", { name: "Play", exact: true }).tap();
  }
  await tutorialPlay();
  check(
    (await read()).active.id === tutorialRunId &&
      !(await page
        .getByRole("button", { name: "Resume", exact: true })
        .count()),
    "tutorial Play resumes a paused run",
  );
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await tutorialPlay();
  check(
    (await read()).active.id === tutorialRunId &&
      (await page.locator('[data-slot="0"]').isVisible()),
    "tutorial Play from home opens the saved run",
  );
  await tapPlace(0, 0);
  let p = await until((p) => p.active.moves === 2);
  check(
    p.active.board[0] === 1 &&
      p.active.score === 10 &&
      p.active.tray[0] === null,
    "tap placement consumes exactly one piece and persists",
  );
  await page.waitForFunction(
    () =>
      window.inputFrames.some(
        (f) => f.index === 0 && f.after.includes("color-1"),
      ),
    null,
    { timeout: 2000 },
  );
  check(
    await page.evaluate(() =>
      window.inputFrames.some(
        (f) => f.index === 0 && f.after.includes("color-1"),
      ),
    ),
    "accepted placement is visible in the first two animation frames",
  );
  await tapPlace(1, 1);
  await tapPlace(2, 8);
  p = await until((p) => p.active.moves === 4 && p.active.phase === "playing");
  check(
    p.active.tray.every(Boolean) && p.active.score === 40,
    "tray refills only after all three pieces are used",
  );
  const save = p.active;
  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).tap();
  p = await until((p) => p.active.moves === 4);
  check(
    JSON.stringify(p.active.board) === JSON.stringify(save.board) &&
      JSON.stringify(p.active.tray) === JSON.stringify(save.tray) &&
      p.active.rng === save.rng,
    "reload restores exact board, tray and RNG",
  );
  await page.getByRole("button", { name: "Pause game" }).tap();
  await page.getByRole("heading", { name: "Paused", exact: true }).waitFor();
  const before = (await read()).stats.playtime;
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Resume", exact: true }).tap();
  await page.getByRole("button", { name: "Pause game" }).tap();
  p = await read();
  check(
    p.stats.playtime - before < 200,
    "paused time does not enter statistics",
  );
  await page.getByRole("button", { name: "Resume", exact: true }).tap();
  await write(fixture());
  await page.locator('[data-slot="1"]').focus();
  await page.keyboard.press("Enter");
  check(
    (await page.locator(".valid-preview").count()) === 2,
    "keyboard selection shows full piece preview",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  p = await until((p) => p.active.moves === 2);
  check(
    p.active.board[8] === 2 && p.active.board[9] === 2,
    "keyboard placement uses the displayed anchor",
  );
  await page.locator('[data-slot="0"]').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  check(
    (await page.locator(".valid-preview").count()) === 0 &&
      (await page
        .getByRole("heading", { name: "Paused", exact: true })
        .count()) === 0,
    "Escape cancels selection without pausing",
  );
  await write(fixture());
  // Mouse and touch share ghost projection. Verify highlights BEFORE release.
  let rect = await page.locator(".block-board").boundingBox(),
    art = await page.locator('[data-slot="1"] .piece-art').boundingBox();
  const step = (rect.width - 13) / 8;
  await page.mouse.move(art.x + art.width / 2, art.y + art.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + 8 + 3 * step + (2 * step - 3) / 2,
    rect.y + 8 + 2 * step + (step - 3) / 2,
    { steps: 8 },
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[data-cell="19"]')
      ?.classList.contains("valid-preview"),
  );
  check(
    (await page
      .locator('[data-cell="19"]')
      .evaluate((el) => el.classList.contains("valid-preview"))) &&
      (await page
        .locator('[data-cell="20"]')
        .evaluate((el) => el.classList.contains("valid-preview"))),
    "mouse ghost previews the intended two squares",
  );
  await page.waitForTimeout(80);
  const ghost = await page.locator(".drag-ghost").boundingBox();
  check(
    Math.abs(ghost.x - (rect.x + 8 + 3 * step)) < 3 &&
      Math.abs(ghost.y - (rect.y + 8 + 2 * step)) < 3,
    "floating piece uses viewport coordinates without ancestor offset",
  );
  await page.mouse.up();
  p = await until((p) => p.active.moves === 2);
  check(
    p.active.board[19] === 2 && p.active.board[20] === 2,
    "mouse drop matches preview",
  );
  await write(fixture());
  await page.locator('[data-slot="0"]').tap();
  await page.setViewportSize({ width: 420, height: 932 });
  await page.waitForTimeout(100);
  check(
    (await page.locator('[data-slot="0"]').getAttribute("aria-pressed")) ===
      "false",
    "resize cancels an active selection",
  );
  await page.setViewportSize({ width: 430, height: 932 });
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })),
      });
    await write(fixture());
    rect = await page.locator(".block-board").boundingBox();
    art = await page.locator('[data-slot="1"] .piece-art').boundingBox();
    const s = (rect.width - 13) / 8,
      lift = Math.max(44, Math.min(72, s * 1.25)),
      x = rect.x + 8 + 4 * s + (2 * s - 3) / 2,
      y = rect.y + 8 + 3 * s + (s - 3) / 2 + lift;
    await touch("touchStart", [
      [art.x + art.width / 2, art.y + art.height / 2],
    ]);
    await touch("touchMove", [[x, y]]);
    await page.waitForTimeout(80);
    check(
      await page
        .locator('[data-cell="28"]')
        .evaluate((el) => el.classList.contains("valid-preview")),
      "touch preview compensates for finger lift",
    );
    await touch("touchEnd", []);
    p = await until((p) => p.active.moves === 2);
    check(
      p.active.board[28] === 2 && p.active.board[29] === 2,
      "real touch drop matches preview",
    );
    await write(fixture());
    art = await page.locator('[data-slot="0"] .piece-art').boundingBox();
    await touch("touchStart", [
      [art.x + art.width / 2, art.y + art.height / 2],
    ]);
    await touch("touchMove", [[x, y]]);
    await touch("touchStart", [
      [x, y],
      [x + 60, y],
    ]);
    await touch("touchEnd", []);
    await page.waitForTimeout(80);
    check(
      (await read()).active.moves === 1 &&
        (await page.locator(".drag-ghost").count()) === 0,
      "second touch cancels a drag without committing",
    );
    await touch("touchStart", [
      [art.x + art.width / 2, art.y + art.height / 2],
    ]);
    await touch("touchMove", [[x, y]]);
    await touch("touchCancel", []);
    check(
      (await read()).active.moves === 1,
      "pointer cancellation never places a piece",
    );
    await touch("touchStart", [
      [art.x + art.width / 2, art.y + art.height / 2],
    ]);
    await touch("touchMove", [[x, y]]);
    await touch("touchStart", [
      [x, y],
      [210, 40],
    ]);
    await touch("touchEnd", []);
    await page.waitForTimeout(50);
    check(
      (await read()).active.moves === 1 &&
        (await page.locator(".drag-ghost").count()) === 0,
      "second finger outside the playfield also cancels a drag",
    );
  }
  let f = fixture();
  f.active.score = 4990;
  f.active.highwater = 4990;
  await write(f);
  await tapPlace(0, 0);
  p = await until((p) => p.active.score === 5000);
  check(
    p.active.charges === 1 && p.active.highwater === 5000,
    "5,000 point milestone earns one undo",
  );
  await page.getByRole("button", { name: "Undo, 1 charges" }).tap();
  p = await until((p) => p.active.moves === 1);
  check(
    p.active.score === 4990 &&
      p.active.charges === 0 &&
      p.active.highwater === 5000 &&
      p.active.tray[0],
    "undo restores placement but keeps the claimed milestone",
  );
  await tapPlace(0, 0);
  p = await until((p) => p.active.score === 5000);
  check(p.active.charges === 0, "replaying a milestone cannot farm undo");
  f = fixture();
  f.active.charges = 1;
  await write(f);
  await tapPlace(0, 0);
  await tapPlace(1, 1);
  await tapPlace(2, 8);
  p = await until((p) => p.active.moves === 4 && p.active.phase === "playing");
  const tray = JSON.stringify(p.active.tray),
    rng = p.active.rng;
  await page.getByRole("button", { name: "Undo, 1 charges" }).tap();
  await until((p) => p.active.moves === 3);
  await tapPlace(2, 8);
  p = await until((p) => p.active.moves === 4 && p.active.phase === "playing");
  check(
    JSON.stringify(p.active.tray) === tray && p.active.rng === rng,
    "undo across a refill reproduces the same deal",
  );
  f = fixture();
  for (let i = 56; i < 63; i++) f.active.board[i] = 1;
  f.active.tray = [piece(), piece(horizontal), piece()];
  await write(f);
  await page.locator('[data-slot="0"]').tap();
  const cell = await page.locator('[data-cell="63"]').boundingBox();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await page.waitForFunction(
    () => document.querySelectorAll(".clear-preview").length === 8,
  );
  check(
    (await page.locator(".clear-preview").count()) === 8,
    "potential full row is highlighted before placement",
  );
  await page.locator('[data-cell="63"]').tap();
  p = await until((p) => p.active.moves === 2);
  check(
    p.active.lines === 1 &&
      p.active.score === 110 &&
      p.active.board.slice(56).every((v) => v === 0),
    "row clears immediately and scores tile plus line points",
  );
  // Blocked board: disjoint empty diagonal squares; a horizontal bar cannot fit.
  f = fixture();
  f.active.board = Array.from({ length: 64 }, (_, i) =>
    Math.floor(i / 8) === i % 8 || (Math.floor(i / 8) + 4) % 8 === i % 8
      ? 0
      : 1,
  );
  f.active.tray = [piece(), piece(horizontal), null];
  f.active.charges = 1;
  await write(f);
  await tapPlace(0, 0);
  p = await until((p) => p.active.phase === "blocked");
  check(
    !p.active.counted &&
      (await page
        .getByRole("button", { name: "Undo · 1", exact: true })
        .count()) === 1,
    "blocked game offers recovery before finalizing",
  );
  const blocked = structuredClone(p);
  await page.getByRole("button", { name: "How to play", exact: true }).tap();
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  check(
    (await read()).active.id === blocked.active.id &&
      (await page
        .getByRole("button", { name: "End run", exact: true })
        .isVisible()),
    "tutorial Play retains blocked run and its recovery options",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  const endButton = page.getByRole("button", { name: "End run", exact: true });
  check(
    await endButton.isVisible(),
    "blocked run offers an explicit End run action",
  );
  await noOverflow("blocked actions fit a narrow phone");
  await fit(page, "blocked recovery fits the viewport");
  await page.evaluate(() => {
    window.effectEvents = [];
  });
  await endButton.tap();
  check(
    await page.evaluate(
      () =>
        window.effectEvents.filter(
          (e) => e.hz > 380 && e.hz < 405 && e.duration > 0.15,
        ).length === 1,
    ),
    "explicit End run plays one descending loss cue",
  );
  const completed = await until((p) => p.active.counted);
  check(
    completed.active.phase === "finished" &&
      completed.active.score === blocked.active.score &&
      completed.active.charges === 1 &&
      completed.stats.runs === 1 &&
      completed.stats.totalScore === blocked.active.score,
    "End run saves the current score despite an unused undo",
  );
  check(
    (await page
      .getByRole("heading", { name: "Run complete", exact: true })
      .isVisible()) &&
      (await endButton.count()) === 0 &&
      (await page
        .getByRole("button", { name: "Undo · 1", exact: true })
        .count()) === 0,
    "ending displays Run complete and removes recovery actions",
  );
  await page.reload();
  const savedEnd = await until((p) => p.active.counted);
  check(
    savedEnd.stats.runs === 1 &&
      savedEnd.stats.totalScore === blocked.active.score &&
      (await page.getByRole("button", { name: /^Continue/ }).count()) === 0,
    "completed run stays finalized after reload and cannot be continued",
  );
  await page.setViewportSize({ width: 430, height: 932 });
  check(
    await page.evaluate(() => window.effectEvents.length === 0),
    "restoring a finished run does not replay its loss cue",
  );
  await tutorialPlay();
  const afterTutorial = await until((p) => p.active?.phase === "playing");
  check(
    afterTutorial.active.id !== blocked.active.id &&
      afterTutorial.stats.runs === 1,
    "tutorial Play after a finished run starts a new game without recounting statistics",
  );
  await write(blocked);
  await page.getByRole("button", { name: "Undo · 1", exact: true }).tap();
  await until((p) => p.active.phase === "playing" && p.active.moves === 1);
  await page.evaluate(() => {
    window.effectEvents = [];
  });
  await tapPlace(0, 0);
  p = await until((p) => p.active.counted);
  check(
    await page.evaluate(
      () =>
        window.effectEvents.filter(
          (e) => e.hz > 380 && e.hz < 405 && e.duration > 0.15,
        ).length === 1,
    ),
    "automatic run completion plays one loss cue",
  );
  check(
    p.stats.runs === 1 && p.stats.totalScore === p.active.score,
    "unrecoverable game finalizes statistics once",
  );
  await page.reload();
  await page.getByRole("button", { name: "Statistics", exact: true }).tap();
  check(
    (await page.locator(".stat").count()) === 6 &&
      (await read()).stats.runs === 1,
    "six statistics survive reload without counting a run twice",
  );
  await page.getByRole("button", { name: "Close dialog" }).tap();
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  await page.getByRole("button", { name: "Dark", exact: true }).click();

  await page.getByLabel("Effects volume", { exact: true }).fill("0.63");
  await page.getByRole("button", { name: "Close dialog" }).tap();
  await until(
    (p) =>
      p.preferences.theme === "dark" && p.preferences.effectsVolume === 0.63,
  );
  await page.reload();
  check(
    await page.evaluate(
      () => document.documentElement.dataset.theme === "dark",
    ),
    "theme and effect volume survive reload",
  );
  await write(fixture());
  await page.locator('[data-slot="0"]').tap();
  await page.waitForTimeout(1700);
  check(
    await page.evaluate(() =>
      window.testMeters.every((m) => m.context.state === "suspended"),
    ),
    "idle effects suspend the context",
  );
  await page.locator('[data-cell="0"]').tap();
  await checkSound("accepted move after idle emits real PCM");
  check(
    await page.evaluate(() => window.testVoices.length === 0),
    "no music players are created",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  check(
    await page.evaluate(() =>
      window.testMeters.every((m) => m.context.state === "suspended"),
    ),
    "background cancels and suspends audio",
  );
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Resume", exact: true }).tap();
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.getByRole("button", { name: /^Continue/ }).tap();
  await page.screenshot({ path: `docs/previews/${engine}-game-light.png` });

  // An illegal drag returns its piece, without a score or snapshot.
  await write(fixture());
  art = await page.locator('[data-slot="1"] .piece-art').boundingBox();
  await page.mouse.move(art.x + art.width / 2, art.y + art.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  p = await read();
  check(
    p.active.moves === 1 &&
      p.active.tray[1] &&
      p.active.history.length === 0 &&
      (await page.locator(".drag-ghost").count()) === 0,
    "out-of-bounds drop returns the piece without changing the run",
  );
  await page.locator('[data-slot="0"]').tap();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  await page.getByRole("heading", { name: "Paused", exact: true }).waitFor();
  check(
    (await page.locator('[data-slot="0"]').getAttribute("aria-pressed")) ===
      "false",
    "backgrounding cancels selection and pauses the run",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await page.getByRole("button", { name: "Resume", exact: true }).tap();
  f = fixture();
  f.active.charges = 1;
  await write(f);
  await page.evaluate(() => {
    window.RealWorker = window.Worker;
    window.Worker = class {
      postMessage(data) {
        window.delayedDealer = { self: this, data };
      }
      terminate() {
        this.terminated = true;
      }
    };
  });
  await tapPlace(0, 0);
  await tapPlace(1, 1);
  await tapPlace(2, 8);
  p = await until((p) => p.active.phase === "dealing");
  const pending = structuredClone(p.active),
    oldDeal = core.dealTray(pending.board, pending.rng);
  await page.getByRole("button", { name: "Undo, 1 charges" }).tap();
  await until((p) => p.active.moves === 3 && p.active.phase === "playing");
  await page.evaluate((deal) => {
    const { self, data } = window.delayedDealer;
    self.onmessage({
      data: { id: data.id, runId: data.runId, revision: data.revision, deal },
    });
  }, oldDeal);
  await page.waitForTimeout(80);
  p = await read();
  check(
    p.active.moves === 3 &&
      p.active.phase === "playing" &&
      p.active.tray[2] &&
      (await page.evaluate(() => window.delayedDealer.self.terminated)),
    "late dealer response is ignored after undo and its worker is terminated",
  );
  await page.evaluate(() => {
    window.Worker = window.RealWorker;
  });
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.evaluate(() => {
    window.Worker = class {
      constructor() {
        throw Error("Worker unavailable in test");
      }
    };
  });
  await page.getByRole("button", { name: "New game", exact: true }).tap();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Discard and start anew", exact: true })
    .tap();
  p = await until((p) => p.active.phase === "playing" && p.active.moves === 0);
  check(
    p.active.tray.every((q) => core.SHAPE_BY_ID.get(q.shape).count === 1),
    "worker startup failure uses a verified playable fallback",
  );
  await page.evaluate(() => {
    window.Worker = window.RealWorker;
  });
  await tapPlace(0, 0);
  await until((p) => p.active.moves === 1);
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.waitForTimeout(100);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("blocks-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("profile", "readwrite");
          tx.objectStore("profile").put(
            { version: 1, active: { broken: true } },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page
    .getByText("Your save was recovered from its backup.", { exact: false })
    .waitFor();
  check(true, "corrupted current save recovers the previous valid backup");
  await page.getByRole("button", { name: /^Continue/ }).tap();
  await page.locator('[data-slot="1"]:not(:disabled)').waitFor();
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).tap();
  await page.locator('[data-slot="1"]:not(:disabled)').waitFor();
  check(true, "cached app and saved run reopen offline");
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.getByRole("button", { name: "New game", exact: true }).tap();
  if (await page.locator("dialog").count())
    await page
      .locator("dialog")
      .getByRole("button", { name: "Discard and start anew", exact: true })
      .tap();
  await until((p) => p.active.moves === 0 && p.active.phase === "playing");
  check(true, "fresh worker deal works with network disabled");
  await context.setOffline(false);
  check(
    errors.length === 0,
    "no browser exceptions or console errors: " + errors.join("; "),
  );
  console.log(`${checks} ${engine} checks passed`);
} finally {
  await context.close();
  await h.close();
}
