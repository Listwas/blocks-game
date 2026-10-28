import { useEffect, useRef, useState } from "react";
const query =
  "(orientation: landscape) and (max-height: 500px) and (pointer: coarse)";
export const phoneLandscape = () => matchMedia(query).matches;
export function PortraitGuard({ onRotate }: { onRotate: () => void }) {
  const callback = useRef(onRotate);
  callback.current = onRotate;
  const [blocked, setBlocked] = useState(phoneLandscape);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => {
      setBlocked(media.matches);
      if (media.matches) callback.current();
    };
    media.addEventListener("change", update);
    if (media.matches) callback.current();
    const lock = () => {
      if (
        matchMedia("(pointer: coarse)").matches &&
        Math.min(screen.width, screen.height) < 600
      ) {
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (value: string) => Promise<void>;
        };
        void orientation?.lock?.("portrait").catch(() => {});
      }
    };
    document.addEventListener("fullscreenchange", lock);
    lock();
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("fullscreenchange", lock);
    };
  }, []);
  return blocked ? (
    <div
      className="portrait-guard"
      role="alertdialog"
      aria-modal="true"
      aria-label="Turn your phone upright"
    >
      <span aria-hidden="true">↻</span>
      <h2>Turn your phone upright</h2>
      <p>Your game is paused. Rotate back to continue.</p>
    </div>
  ) : null;
}
