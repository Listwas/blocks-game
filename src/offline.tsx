import { useEffect, useRef, useState } from "react";

export function useOffline() {
  const [status, setStatus] = useState<"preparing" | "ready" | "unavailable">(
    "preparing",
  );
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const requested = useRef(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setStatus("unavailable");
      return;
    }
    let live = true;
    const cleanups: (() => void)[] = [];
    const controlled = () => {
      if (requested.current) location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", controlled);
    void navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        if (!live) return;
        const waiting = () => {
          if (
            live &&
            navigator.serviceWorker.controller &&
            registration.waiting
          )
            setUpdate(registration.waiting);
        };
        const installing = () => {
          const worker = registration.installing;
          if (!worker) return;
          const changed = () => {
            if (!live) return;
            if (worker.state === "installed") {
              setStatus("ready");
              waiting();
            }
            if (worker.state === "redundant" && !registration.active)
              setStatus("unavailable");
          };
          worker.addEventListener("statechange", changed);
          cleanups.push(() =>
            worker.removeEventListener("statechange", changed),
          );
          changed();
        };
        registration.addEventListener("updatefound", installing);
        cleanups.push(() =>
          registration.removeEventListener("updatefound", installing),
        );
        installing();
        waiting();
        await navigator.serviceWorker.ready;
        if (live) {
          setStatus("ready");
          waiting();
        }
      })
      .catch(() => {
        if (live) setStatus("unavailable");
      });
    return () => {
      live = false;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controlled,
      );
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
  const refresh = async (save: () => Promise<void>) => {
    if (requested.current || !update) return;
    setRefreshing(true);
    setError("");
    try {
      await save();
      const registration = await navigator.serviceWorker.getRegistration();
      requested.current = true;
      if (registration?.waiting) registration.waiting.postMessage("activate");
      else location.reload(); // Another tab may have activated the waiting version.
    } catch {
      requested.current = false;
      setRefreshing(false);
      setError(
        "Could not save before updating. Keep this tab open and try again.",
      );
    }
  };
  return {
    status,
    update,
    error,
    refreshing,
    refresh,
    dismissError: () => setError(""),
  };
}
export type OfflineState = ReturnType<typeof useOffline>;
export function OfflineStatus({
  offline,
  onRefresh,
}: {
  offline: OfflineState;
  onRefresh: () => void;
}) {
  return (
    <div className="offline-status" role="status">
      <span
        className={"offline-dot " + (offline.status === "ready" ? "ready" : "")}
        aria-hidden="true"
      />
      <span>
        {offline.status === "ready"
          ? "Ready offline"
          : offline.status === "preparing"
            ? "Preparing offline play…"
            : "Offline play unavailable"}
      </span>
      {offline.update ? (
        <button disabled={offline.refreshing} onClick={onRefresh}>
          {offline.refreshing ? "Saving…" : "Refresh app"}
        </button>
      ) : null}
    </div>
  );
}
