import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
export async function harness() {
  const root = resolve("dist");
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/__test__/effects.html") {
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="play" style="margin:50px;padding:20px;font-size:18px;touch-action:manipulation">Play effect</button></body></html>',
          );
        return;
      }
      if (pathname === "/__test__/audio.js") {
        const module = await build({
          entryPoints: ["src/audio.ts"],
          bundle: true,
          format: "esm",
          write: false,
        });
        res
          .writeHead(200, { "Content-Type": "application/javascript" })
          .end(module.outputFiles[0].text);
        return;
      }
      const file = resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + "/")) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const engine = process.env.BROWSER || "chromium";
  let browser;
  try {
    browser = await (engine === "webkit" ? webkit : chromium).launch({
      headless: true,
      ...(engine === "chromium"
        ? {
            ...(process.env.CHROMIUM_PATH === ""
              ? {}
              : {
                  executablePath:
                    process.env.CHROMIUM_PATH || "/usr/bin/chromium",
                }),
            args: ["--mute-audio"],
          }
        : {}),
    });
  } catch (error) {
    await new Promise((r) => server.close(r));
    throw error;
  }
  return {
    browser,
    engine,
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}
export async function fit(page, label) {
  await page.waitForTimeout(100);
  const failures = await page.evaluate(() => {
    const root =
      document.querySelector("dialog[open]") || document.querySelector("main");
    const errors = [];
    for (const el of [
      root,
      ...root.querySelectorAll(
        "button,input,select,h1,h2,h3,p,.clue,.target,.stat",
      ),
    ]) {
      const r = el.getBoundingClientRect(),
        s = getComputedStyle(el);
      if (
        !r.width ||
        !r.height ||
        s.visibility === "hidden" ||
        s.display === "none" ||
        el.closest('[aria-hidden="true"]') ||
        s.position === "fixed"
      )
        continue;
      if (
        r.left < -1 ||
        r.top < -1 ||
        r.right > innerWidth + 1 ||
        r.bottom > innerHeight + 1
      )
        errors.push(
          `${el.className || el.tagName} outside viewport (${r.x},${r.y},${r.width},${r.height})`,
        );
    }
    for (const el of [
      root,
      ...root.querySelectorAll(
        ".dialog-body,.settings-panel,.tutorial,.stats-grid",
      ),
    ]) {
      if (
        el.scrollHeight > el.clientHeight + 2 ||
        el.scrollWidth > el.clientWidth + 2
      )
        errors.push(
          `${el.className} clips/scrolls ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`,
        );
    }
    if (
      document.documentElement.scrollHeight > innerHeight + 1 ||
      document.documentElement.scrollWidth > innerWidth + 1
    )
      errors.push("document scrolls");
    const tutorialActions = document.querySelector(
      "dialog[open] .tutorial-actions",
    );
    if (tutorialActions) {
      const action = [...tutorialActions.querySelectorAll("button")].find((b) =>
        /^(Next|Play)$/.test(b.textContent.trim()),
      );
      if (
        action &&
        Math.abs(
          action.getBoundingClientRect().right -
            tutorialActions.getBoundingClientRect().right,
        ) > 2
      )
        errors.push("tutorial forward action must align right");
    }
    if (tutorialActions) {
      const forward = [...tutorialActions.querySelectorAll("button")].find(
        (b) => /^(Next|Play)$/.test(b.textContent.trim()),
      );
      if (
        forward &&
        forward.getBoundingClientRect().width >
          tutorialActions.getBoundingClientRect().width * 0.65
      )
        errors.push(
          "tutorial forward action must be a compact button on the right",
        );
    }
    if (!document.querySelector("dialog[open]")) {
      for (const [outer, inner] of [
        [".home-middle", ".home-group"],
        [".game-viewport", ".game-group"],
        [".selection-middle", ".selection-group"],
      ]) {
        const container = document.querySelector(outer),
          group = document.querySelector(inner);
        if (!container || !group) continue;
        const a = container.getBoundingClientRect(),
          b = group.getBoundingClientRect();
        if (
          Math.abs(a.top + a.height / 2 - b.top - b.height / 2) > 4 ||
          Math.abs(a.left + a.width / 2 - b.left - b.width / 2) > 4
        )
          errors.push(inner + " is not centered");
        if (b.height > a.height + 2)
          errors.push(inner + " exceeds allocated height");
      }
      for (const [groupName, headerName] of [
        [".home-group", ".home-header, .brand-row"],
        [".game-group", ".game-header"],
        [".selection-group", "header"],
      ]) {
        const group = document.querySelector(groupName);
        if (!group) continue;
        if (!group.querySelector(headerName))
          errors.push(groupName + " must include its header");
      }
      const home = document.querySelector(".home-group");
      if (home && !home.querySelector(".home-footer,.menu-footer"))
        errors.push("home status must be part of the centered group");
      const nav = document.querySelector(".home-nav");
      if (nav) {
        const [a, b] = [...nav.querySelectorAll("button")].map((el) =>
          el.getBoundingClientRect(),
        );
        if (Math.abs(a.top - b.top) > 1 || a.right > b.left + 1)
          errors.push("home navigation is not side by side");
      }
      const help = document.querySelector(
          '.game-header button[aria-label="How to play"]',
        ),
        pause = document.querySelector(
          '.game-header button[aria-label^="Pause"]',
        );
      if (
        help &&
        pause &&
        help.getBoundingClientRect().left <= pause.getBoundingClientRect().left
      )
        errors.push("Help must be right of Pause");
    }
    return errors;
  });
  if (failures.length) throw Error(label + ": " + failures.join("; "));
}

export function instrumentInput() {
  window.inputFrames = [];
  document.addEventListener(
    "pointerup",
    (event) => {
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-cell]");
      if (!cell) return;
      const at = performance.now(),
        before = cell.className,
        index = Number(cell.getAttribute("data-cell"));
      const record = (frame) =>
        window.inputFrames.push({
          index,
          before,
          after: cell.className,
          ms: performance.now() - at,
          frame,
        });
      requestAnimationFrame(() => {
        record(1);
        requestAnimationFrame(() => record(2));
      });
    },
    true,
  );
}

export function instrumentEffects() {
  window.effectEvents = [];
  const create = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function (...args) {
    const voice = create.apply(this, args),
      start = voice.start;
    voice.start = function (...when) {
      const b = this.buffer;
      if (b) {
        const samples = b.getChannelData(0);
        let crossing = -1;
        for (let i = 2; i < samples.length; i++)
          if (samples[i - 1] > 0 && samples[i] <= 0) {
            crossing = i;
            break;
          }
        window.effectEvents.push({
          hz: crossing > 0 ? b.sampleRate / (2 * crossing) : 0,
          duration: b.duration,
        });
      }
      return start.apply(this, when);
    };
    return voice;
  };
}
