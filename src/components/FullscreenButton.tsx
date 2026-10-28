import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function FullscreenButton() {
  const [, refresh] = useState(0);
  const [message, setMessage] = useState("");
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenElement;
  const installedFullscreen = matchMedia("(display-mode: fullscreen)").matches;
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const active = !!(doc.fullscreenElement || doc.webkitFullscreenElement);

  useEffect(() => {
    const update = () => refresh((n) => n + 1);
    const modes = ["fullscreen", "standalone"].map((mode) =>
      matchMedia(`(display-mode: ${mode})`),
    );
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    modes.forEach((mode) => mode.addEventListener("change", update));
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
      modes.forEach((mode) => mode.removeEventListener("change", update));
    };
  }, []);

  async function toggle() {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen)
        await doc.webkitExitFullscreen();
      else if (doc.fullscreenEnabled && root.requestFullscreen)
        await root.requestFullscreen({ navigationUI: "hide" });
      else if (root.webkitRequestFullscreen)
        await root.webkitRequestFullscreen();
      else if (standalone || installedFullscreen)
        setMessage(
          "This browser cannot hide the time and battery indicators. Home Screen mode removes browser controls, but does not guarantee hidden system bars.",
        );
      else
        setMessage(
          "For the largest view, add this game to your Home Screen and open its icon. On iPhone or iPad: open it in Safari, tap Share, then Add to Home Screen. Leave Open as Web App on if offered. Your device may still show its status indicators.",
        );
    } catch {
      setMessage(
        "Your browser did not allow fullscreen. Try the fullscreen button again. System bars may remain visible on this device.",
      );
    }
    refresh((n) => n + 1);
  }

  return (
    <>
      <button
        className="icon"
        aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={() => void toggle()}
      >
        <Icon name={active ? "exitFullscreen" : "fullscreen"} />
      </button>
      {message ? (
        <Dialog title="Fullscreen" onClose={() => setMessage("")}>
          <p>{message}</p>
          <button className="primary full" onClick={() => setMessage("")}>
            Got it
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
