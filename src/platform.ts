import type { Preferences } from "./core/profile";

/** Also cached synchronously for the next launch, before IndexedDB can open. */
export function applyAppearance(theme: Preferences["theme"]) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1c232a" : "#f6f5f1");
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute("content", "black-translucent");
  try {
    localStorage.setItem("blocks-appearance", theme);
  } catch {
    /* The profile remains authoritative if this optional boot cache is unavailable. */
  }
}
