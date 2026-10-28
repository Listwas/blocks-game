import assert from "node:assert/strict";
import { harness, fit } from "./support.mjs";
const h = await harness();
let checks = 0;
try {
  for (const mode of [
    "supported",
    "installed-supported",
    "unsupported",
    "standalone",
    "installed",
    "rejected",
    "prefixed",
  ]) {
    const context = await h.browser.newContext({
      viewport: { width: 320, height: 568 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: "block",
    });
    try {
      await context.addInitScript((mode) => {
        window.fullscreenCalls = [];
        let active = null;
        const match = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const media = match(query);
          if (query.startsWith("(display-mode:"))
            Object.defineProperty(media, "matches", {
              value:
                query ===
                `(display-mode: ${mode === "installed" || mode === "installed-supported" ? "fullscreen" : mode === "standalone" ? "standalone" : "browser"})`,
            });
          return media;
        };
        Object.defineProperty(navigator, "standalone", {
          value: mode === "standalone",
        });
        Object.defineProperty(document, "fullscreenEnabled", {
          get: () =>
            mode === "supported" ||
            mode === "installed-supported" ||
            mode === "rejected",
        });
        Object.defineProperty(document, "fullscreenElement", {
          get: () => (mode === "prefixed" ? null : active),
        });
        Object.defineProperty(document, "webkitFullscreenElement", {
          get: () => (mode === "prefixed" ? active : null),
        });
        const enter = async (options) => {
          window.fullscreenCalls.push(options || "prefixed");
          if (mode === "rejected") throw Error("denied");
          active = document.documentElement;
          document.dispatchEvent(
            new Event(
              mode === "prefixed"
                ? "webkitfullscreenchange"
                : "fullscreenchange",
            ),
          );
        };
        const exit = async () => {
          active = null;
          document.dispatchEvent(
            new Event(
              mode === "prefixed"
                ? "webkitfullscreenchange"
                : "fullscreenchange",
            ),
          );
        };
        HTMLElement.prototype.requestFullscreen = enter;
        document.exitFullscreen = exit;
        HTMLElement.prototype.webkitRequestFullscreen =
          mode === "prefixed" ? enter : undefined;
        document.webkitExitFullscreen = mode === "prefixed" ? exit : undefined;
      }, mode);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(h.base);
      const button = page.getByRole("button", {
        name: "Enter fullscreen",
        exact: true,
      });
      await button.waitFor();
      await fit(page, "fullscreen home ready");
      assert.equal(
        await page
          .locator('meta[name="apple-mobile-web-app-status-bar-style"]')
          .getAttribute("content"),
        "black-translucent",
      );
      const manifest = await (
        await page.request.get(
          new URL(
            await page.locator('link[rel="manifest"]').getAttribute("href"),
            h.base,
          ).href,
        )
      ).json();
      assert.equal(manifest.display, "fullscreen");
      assert.equal(manifest.display_override[0], "fullscreen");
      assert.equal(await page.evaluate(() => window.fullscreenCalls.length), 0);
      const settings = await page
        .getByRole("button", { name: "Settings", exact: true })
        .boundingBox();
      const fs = await button.boundingBox();
      assert(fs.x + fs.width <= settings.x + 1);
      assert(Math.abs(fs.y - settings.y) < 2);
      await button.tap();
      if (
        mode === "supported" ||
        mode === "installed-supported" ||
        mode === "prefixed"
      ) {
        const exit = page.getByRole("button", {
          name: "Exit fullscreen",
          exact: true,
        });
        await exit.waitFor();
        assert.equal(
          await page.evaluate(() => window.fullscreenCalls.length),
          1,
        );
        if (mode === "supported" || mode === "installed-supported")
          assert.deepEqual(
            await page.evaluate(() => window.fullscreenCalls[0]),
            { navigationUI: "hide" },
          );
        await exit.tap();
        await button.waitFor();
      } else {
        const dialog = page.getByRole("dialog", {
          name: "Fullscreen",
          exact: true,
        });
        await dialog.waitFor();
        assert.match(
          await dialog.innerText(),
          mode === "installed" || mode === "standalone"
            ? /cannot hide the time and battery indicators/
            : mode === "rejected"
              ? /did not allow fullscreen/
              : /Add to Home Screen/,
        );
        await fit(page, `${mode} fullscreen guidance`);
        await page.getByRole("button", { name: "Got it", exact: true }).tap();
        assert.equal(await page.getByRole("dialog").count(), 0);
      }
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await page.getByRole("button", { name: "Dark", exact: true }).tap();
      assert.equal(
        await page
          .locator('meta[name="apple-mobile-web-app-status-bar-style"]')
          .getAttribute("content"),
        "black-translucent",
      );
      assert.deepEqual(errors, [], "No browser errors during fullscreen flow");
      checks++;
    } finally {
      await context.close();
    }
  }
  console.log(
    `PASS ${checks} ${h.engine} fullscreen scenarios: mobile button, install metadata, standard/prefixed enter/exit, installed mode, unavailable/denied guidance, compact fit and theme persistence`,
  );
} finally {
  await h.close();
}
