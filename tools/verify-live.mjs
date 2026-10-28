import assert from "node:assert/strict";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium, webkit } from "playwright";
const name = JSON.parse(await readFile("package.json", "utf8")).name;
const game = name === "number-sums-browser" ? "number-sums" : name;
const base = process.env.LIVE_URL || `https://${game}-game.pages.dev`;
async function files(dir) {
  const entries = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + e.name;
    if (e.isDirectory()) entries.push(...(await files(path)));
    else if (e.name !== "_headers") entries.push(path);
  }
  return entries;
}
const paths = await files("dist");
let bytes = 0;
for (const file of paths) {
  const local = await readFile(file);
  let remote;
  for (let attempt = 0; attempt < 3; attempt++) {
    remote = execFileSync(
      "curl",
      [
        "-fsSL",
        "--connect-timeout",
        "10",
        "--max-time",
        "30",
        "--compressed",
        "--retry",
        "2",
        base +
          "/" +
          file.slice(5) +
          "?verify=" +
          createHash("sha256").update(local).digest("hex").slice(0, 12) +
          "&request=" +
          Date.now() +
          "-" +
          attempt,
      ],
      { maxBuffer: 5000000 },
    );
    if (remote.equals(local)) break;
    if (attempt < 2) {
      console.log(
        `Retrying ${file}: deployment has not propagated (${remote.length} bytes)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  // Never ask assert to format a binary diff: a transient CDN mismatch can
  // expand into an enormous diagnostic allocation for a bundled JavaScript file.
  if (!remote.equals(local)) {
    const digest = (data) => createHash("sha256").update(data).digest("hex");
    throw new Error(
      `Published ${file} differs: local ${local.length} bytes (${digest(local)}), remote ${remote.length} bytes (${digest(remote)}). Retry after deployment propagation.`,
    );
  }
  console.log(`Verified ${file}: ${local.length} bytes`);
  bytes += local.length;
}
assert(
  !paths.some((p) => /\.(m4a|ttf|woff2?|wasm|pck)$/.test(p)),
  "no music/font/engine payload",
);
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
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "New game", exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "New game", exact: true }).click();
  if (game !== "blocks")
    await page.getByRole("button", { name: /^Easy/ }).click();
  await page.locator('[data-cell="0"]').waitFor();
  const dbName =
    game === "number-sums" ? "number-sums-browser-profile" : game + "-profile";
  const profile = () =>
    page.evaluate(
      (dbName) =>
        new Promise((resolve) => {
          const r = indexedDB.open(dbName);
          r.onsuccess = () => {
            const db = r.result,
              t = db.transaction("profile"),
              q = t.objectStore("profile").get("current");
            t.oncomplete = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
      dbName,
    );
  if (game === "blocks") {
    await page.locator('[data-slot="0"]:not(:disabled)').waitFor();
    await page.locator('[data-slot="0"]').focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll(".board-cell[class*=color-]").length > 0,
    );
  } else {
    let p;
    for (let n = 0; n < 100; n++) {
      p = await profile();
      if (p?.active) break;
      await page.waitForTimeout(20);
    }
    const a = p.active,
      index = a.puzzle.answer.findIndex((v, i) => v && a.cells[i] === 0);
    await page.locator(`[data-cell="${index}"]`).click();
    await page.waitForFunction(
      (index) =>
        document
          .querySelector(`[data-cell="${index}"]`)
          ?.className.match(/filled|marked/),
      index,
    );
  }
  await page
    .getByRole("button", {
      name: game === "number-sums" ? "Back to menu" : "Menu",
      exact: true,
    })
    .click();
  await page
    .getByText("Ready offline", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.reload();
  await page.getByRole("button", { name: /Continue/ }).waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.locator('[data-cell="0"]').waitFor();
  assert.deepEqual(errors, []);
  await mkdir("docs", { recursive: true });
  const report = {
    url: base,
    engine,
    assets: paths.length,
    bytes,
    verifiedAt: new Date().toISOString(),
    checks: [
      "all published assets byte-identical",
      "no music/font/engine payload",
      "dark theme",
      "new puzzle",
      "accepted move",
      "save/reload",
      "offline continuation",
      "no uncaught exceptions",
    ],
  };
  await writeFile(
    `docs/live-${engine}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
}
