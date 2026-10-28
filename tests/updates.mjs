import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const root = resolve("dist");
let version = 0;
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      path = resolve(
        root,
        "." + (url.pathname === "/" ? "/index.html" : url.pathname),
      );
    if (!path.startsWith(root + "/")) {
      res.writeHead(403).end();
      return;
    }
    let data = await readFile(path);
    if (url.pathname === "/sw.js")
      data = Buffer.from(
        data
          .toString()
          .replace(
            /const CACHE='(blocks-[^']+)';/,
            (_, name) => `const CACHE='${name}-update-test-${version}';`,
          ),
      );
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH === ""
      ? {}
      : { executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" }),
    args: ["--mute-audio"],
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByText("Ready offline", { exact: true })
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.locator('[data-slot="0"]:not(:disabled)').waitFor();
  await page.locator('[data-slot="0"]').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelectorAll(".board-cell[class*=color-]").length > 0,
  );
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("blocks-profile", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db
                .transaction("profile")
                .objectStore("profile")
                .get("current");
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
    );
  const before = await read();
  assert.equal(before.active.moves, 1);
  version++;
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update();
  });
  await page
    .getByRole("button", { name: "Refresh app", exact: true })
    .waitFor({ timeout: 60000 });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Refresh app", exact: true }).click(),
  ]);
  await page.getByRole("heading", { name: "Blocks", exact: true }).waitFor();
  await page.getByRole("button", { name: /^Continue/ }).waitFor();
  const after = await read();
  assert.equal(after.active.id, before.active.id);
  assert.deepEqual(after.active.board, before.active.board);
  assert.deepEqual(after.active.tray, before.active.tray);
  assert.equal(after.active.rng, before.active.rng);
  assert.equal(after.active.moves, 1);
  console.log(
    "PASS actual waiting service worker activates, reloads, and preserves exact saved run",
  );
  const cachesAfter = await page.evaluate(() => caches.keys());
  assert.equal(cachesAfter.length, 1);
  assert.ok(cachesAfter[0].endsWith("-update-test-1"));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.locator(".block-board").waitFor();
  assert.deepEqual((await read()).active.board, before.active.board);
  console.log(
    "PASS updated offline cache reopens the saved run; previous cache removed",
  );
  const assets = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(
      keys.map(async (key) =>
        (await (await caches.open(key)).keys()).map((r) => r.url),
      ),
    );
    return entries.flat();
  });
  assert(
    !assets.some((url) => url.includes("/audio/")),
    "offline cache contains no soundtrack",
  );
  console.log("PASS updated cache contains no music payload");
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
