import { FullscreenButton } from "./components/FullscreenButton";
import { PortraitGuard, phoneLandscape } from "./PortraitGuard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Playfield, type ClearFlash } from "./components/Playfield";
import { Brand, Icon } from "./components/Icon";
import { SettingsPanel } from "./components/SettingsPanel";
import { useOffline, OfflineStatus } from "./offline";
import { Dialog } from "./components/Dialog";
import { Tutorial } from "./components/Tutorial";
import { MILESTONE, type Deal } from "./core/blocks";
import {
  newRun,
  commit,
  undo,
  acceptDeal,
  dealKey,
  resumable,
} from "./core/run";
import {
  addTime,
  finalize,
  discardUnstarted,
  type Preferences,
  type Profile,
  type ProfileStore,
} from "./core/profile";
import { AudioEngine } from "./audio";
import { applyAppearance } from "./platform";
import { Dealer } from "./dealer";
const number = (value: number) => Math.floor(value).toLocaleString("en-US");
const duration = (ms: number) =>
  ms >= 3600000
    ? `${(ms / 3600000).toFixed(1)} h`
    : ms >= 60000
      ? `${Math.floor(ms / 60000)} min`
      : `${Math.floor(ms / 1000)} sec`;
type Modal = "settings" | "tutorial" | "new" | "stats" | null;
export function App({
  profile: p,
  store,
}: {
  profile: Profile;
  store: ProfileStore;
}) {
  const [, setTick] = useState(0),
    render = () => setTick((v) => v + 1);
  const [ui] = useState(() => ({
    screen: "home" as "home" | "game",
    paused: false,
    modal: null as Modal,
    notice: store.notice,
    retry: 0,
    dealError: false,
    flash: null as ClearFlash | null,
    points: 0,
    earned: 0,
    feedbackId: 0,
    settling: false,
  }));
  const offline = useOffline();
  const [audio] = useState(() => new AudioEngine(p.preferences));
  const [dealer] = useState(() => new Dealer());
  const gesture = useCallback(() => void audio.unlock(), [audio]);
  const clock = useRef(performance.now()),
    startingRun = useRef<string | null>(null),
    saveFailed = useRef(false),
    saveRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    saveBackoff = useRef(5000),
    mounted = useRef(true),
    settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const active = (includeHidden = false) =>
    !phoneLandscape() &&
    ui.screen === "game" &&
    !ui.paused &&
    !ui.modal &&
    (!document.hidden || includeHidden) &&
    p.active?.phase === "playing";
  const collect = (includeHidden = false) => {
    const now = performance.now();
    if (active(includeHidden)) addTime(p, Math.max(0, now - clock.current));
    clock.current = now;
  };
  const persist = () => {
    clearTimeout(saveRetry.current);
    void store
      .save(p)
      .then(() => {
        clearTimeout(saveRetry.current);
        saveBackoff.current = 5000;
        if (!mounted.current) return;
        if (saveFailed.current) {
          saveFailed.current = false;
          ui.notice = "";
          render();
        }
      })
      .catch(() => {
        if (!mounted.current) return;
        const firstFailure = !saveFailed.current;
        saveFailed.current = true;
        ui.notice =
          "Progress could not be saved. Leave this tab open; we’ll keep trying.";
        if (firstFailure) render();
        if (!document.hidden) {
          saveRetry.current = setTimeout(persist, saveBackoff.current);
          saveBackoff.current = Math.min(60000, saveBackoff.current * 2);
        }
      });
  };
  const clearFeedback = () => {
    clearTimeout(feedbackTimer.current);
    clearTimeout(settleTimer.current);
    ui.settling = false;
    ui.feedbackId++;
    ui.flash = null;
    ui.points = 0;
    ui.earned = 0;
  };
  const preference = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    p.preferences = { ...p.preferences, [key]: value };
    audio.setPreferences(p.preferences);
    persist();
    render();
  };
  const open = (modal: Modal) => {
    collect();
    ui.modal = modal;
    persist();
    render();
  };
  const close = () => {
    ui.modal = null;
    clock.current = performance.now();
    render();
  };
  const navigate = (screen: typeof ui.screen) => {
    collect();
    dealer.cancel();
    clearFeedback();
    if (screen === "home") {
      discardUnstarted(p);
      startingRun.current = null;
    }
    ui.screen = screen;
    ui.modal = null;
    ui.paused = false;
    ui.flash = null;
    clock.current = performance.now();
    window.scrollTo(0, 0);
    persist();
    render();
  };
  const start = () => {
    collect();
    dealer.cancel();
    clearFeedback();
    if (p.active && !p.active.counted) finalize(p);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    p.active = newRun(seed);
    startingRun.current = p.active.id;
    ui.screen = "game";
    ui.paused = false;
    ui.modal = null;
    ui.dealError = false;
    ui.flash = null;
    ui.points = 0;
    clock.current = performance.now();
    window.scrollTo(0, 0);
    persist();
    render();
  };
  const requestNew = () => {
    if (resumable(p.active)) open("new");
    else start();
  };
  const refreshApp = () => {
    collect();
    ui.paused = true;
    render();
    void offline.refresh(() => store.save(p));
  };
  const pause = () => {
    collect();
    dealer.cancel();
    clearFeedback();
    ui.paused = true;
    ui.flash = null;
    persist();
    void store.flush().catch(() => {});
    render();
  };
  const play = useCallback(
    (slot: number, row: number, col: number) => {
      if (!active() || !p.active) return false;
      collect();
      const event = commit(p.active, slot, row, col);
      if (!event) return false;
      p.active = event.run;
      ui.feedbackId++;
      const id = ui.feedbackId;
      ui.points = event.points;
      ui.earned = event.earned;
      const reducedMotion =
        p.preferences.reduceMotion ||
        matchMedia("(prefers-reduced-motion: reduce)").matches;
      ui.flash =
        event.result.lines && !reducedMotion
          ? {
              id,
              cells: event.result.cleared.map((index) => ({
                index,
                color: event.result.painted[index],
              })),
            }
          : null;
      const runId = p.active.id;
      ui.settling =
        !!event.result.lines &&
        (p.active.phase === "finished" || p.active.phase === "blocked") &&
        !reducedMotion;
      clearTimeout(settleTimer.current);
      if (ui.flash) {
        settleTimer.current = setTimeout(() => {
          if (ui.feedbackId !== id || p.active?.id !== runId) return;
          ui.settling = false;
          ui.flash = null;
          if (p.active.phase === "finished") audio.effect("gameover");
          render();
        }, 220);
      }
      audio.effect(
        p.active.phase === "finished" && !ui.settling
          ? "gameover"
          : event.earned
            ? "reward"
            : event.result.lines
              ? p.active.chain > 1
                ? "combo"
                : "clear"
              : "place",
      );
      if (p.active.phase === "finished") finalize(p);
      persist();
      render();
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => {
        if (ui.feedbackId === id) {
          ui.flash = null;
          ui.points = 0;
          ui.earned = 0;
          render();
        }
      }, 700);
      return true;
    },
    [p, ui, audio, store],
  );
  const endBlockedRun = () => {
    if (!p.active || p.active.phase !== "blocked" || ui.paused || ui.modal)
      return;
    collect();
    finalize(p);
    ui.flash = null;
    ui.points = 0;
    ui.earned = 0;
    audio.effect("gameover");
    persist();
    render();
  };
  const reverse = () => {
    dealer.cancel();
    clearFeedback();
    if (!p.active || ui.paused || ui.modal) return;
    collect();
    const previous = undo(p.active);
    if (!previous) return;
    p.active = previous;
    ui.flash = null;
    ui.points = 0;
    ui.earned = 0;
    ui.dealError = false;
    clock.current = performance.now();
    audio.effect("tap");
    persist();
    render();
  };
  useEffect(() => {
    const r = p.active;
    if (
      !r ||
      r.phase !== "dealing" ||
      ui.screen !== "game" ||
      ui.paused ||
      ui.modal ||
      document.hidden
    )
      return;
    const { id: runId, revision } = r;
    let stopped = false;
    const finish = (deal: Deal | null) => {
      if (
        stopped ||
        p.active?.id !== runId ||
        p.active.revision !== revision ||
        p.active.phase !== "dealing"
      )
        return;
      const accepted = deal && acceptDeal(p.active, deal);
      if (!accepted) {
        ui.dealError = true;
        render();
        return;
      }
      collect();
      p.active = accepted;
      if (startingRun.current === runId) {
        startingRun.current = null;
        audio.effect("start");
      }
      ui.dealError = false;
      persist();
      render();
    };
    const cached = r.deals.find((d) => d.key === dealKey(r));
    const cancel = cached
      ? (finish(cached.deal), () => {})
      : dealer.request({ runId, revision, board: r.board, rng: r.rng }, finish);
    return () => {
      stopped = true;
      cancel();
    };
  }, [
    p.active?.id,
    p.active?.revision,
    p.active?.phase,
    ui.screen,
    ui.paused,
    ui.modal,
    ui.retry,
  ]);
  // Blocks has no ticking clock on screen. Accumulate time at saves and
  // actions without rerendering the board while the player is thinking.
  const playing = active();
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (!active()) return;
      collect();
      persist();
    }, 5000);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    mounted.current = true;
    const gesture = () => void audio.unlock();
    // Touch activation may only be granted on release, not pointerdown.
    const gestures = ["pointerup", "touchend", "click", "keydown"];
    gestures.forEach((event) => document.addEventListener(event, gesture));
    const background = () => {
      // visibilitychange arrives after document.hidden has changed. Include
      // the final foreground slice before pausing, then stop all idle saves.
      collect(true);
      dealer.dispose();
      clearFeedback();
      if (ui.screen === "game" && p.active && !p.active.counted)
        ui.paused = true;
      ui.flash = null;
      audio.background(true);
      persist();
      void store.flush().catch(() => {});
      render();
    };
    const foreground = () => {
      if (document.hidden) return;
      clock.current = performance.now();
      audio.background(false);
      if (saveFailed.current) persist();
      render();
    };
    const visibility = () => (document.hidden ? background() : foreground());
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      if (ui.modal) close();
      else if (
        ui.screen === "game" &&
        !ui.paused &&
        p.active &&
        !p.active.counted
      )
        pause();
      else if (ui.screen !== "home") navigate("home");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", background);
    window.addEventListener("pageshow", foreground);
    document.addEventListener("keydown", key);

    return () => {
      collect();
      mounted.current = false;
      clearTimeout(saveRetry.current);
      persist();
      audio.dispose();
      dealer.dispose();
      clearTimeout(feedbackTimer.current);
      clearTimeout(settleTimer.current);
      gestures.forEach((event) => document.removeEventListener(event, gesture));
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", background);
      window.removeEventListener("pageshow", foreground);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = p.preferences.reduceMotion
      ? "reduced"
      : "full";
    const media = matchMedia("(prefers-color-scheme: dark)"),
      update = () => applyAppearance(p.preferences.theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [p.preferences.theme, p.preferences.reduceMotion]);
  const r = p.active,
    ended =
      r && !ui.settling && (r.phase === "blocked" || r.phase === "finished"),
    best = Math.max(p.stats.best, r?.score ?? 0),
    nextUndo = (Math.floor((r?.highwater ?? 0) / MILESTONE) + 1) * MILESTONE;
  return (
    <main className={"app screen-" + ui.screen}>
      {ui.notice || offline.error ? (
        <div className="notice" role="status">
          {ui.notice || offline.error}
          <button
            className="icon small"
            aria-label="Dismiss notice"
            onClick={() => {
              ui.notice = "";
              offline.dismissError();
              render();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {ui.screen === "home" ? (
        <>
          <div className="home-middle">
            <div className="home-group">
              <header className="home-header">
                <Brand />
                <div className="header-actions">
                  <FullscreenButton />
                  <button
                    className="icon"
                    aria-label="Settings"
                    onClick={() => open("settings")}
                  >
                    <Icon name="settings" />
                  </button>
                </div>
              </header>
              <section className="home-intro">
                <span className="eyebrow">Block puzzle</span>
                <h1>Blocks</h1>
                <p>
                  Make room
                  <br />
                  for the next move.
                </p>
                <div className="home-best">
                  <span>Best score</span>
                  <strong>{number(best)}</strong>
                </div>
              </section>
              <div className="home-actions">
                {resumable(r) ? (
                  <button
                    className="primary full"
                    onClick={() => navigate("game")}
                  >
                    Continue<span>{number(r.score)} points</span>
                  </button>
                ) : null}
                <button
                  className={(resumable(r) ? "secondary" : "primary") + " full"}
                  onClick={requestNew}
                >
                  New game
                </button>
              </div>
              <nav className="home-nav">
                <button onClick={() => open("stats")}>Statistics</button>
                <button onClick={() => open("tutorial")}>How to play</button>
              </nav>
              <footer className="home-footer">
                <OfflineStatus offline={offline} onRefresh={refreshApp} />
              </footer>
            </div>
          </div>
        </>
      ) : null}
      {ui.screen === "game" && r ? (
        <>
          <div className="game-viewport">
            <div className="game-group">
              <header className="page-header game-header">
                <button
                  className="icon"
                  aria-label="Menu"
                  onClick={() => navigate("home")}
                >
                  <Icon name="back" />
                </button>
                <span>Classic</span>
                <div>
                  <button
                    className="icon"
                    aria-label="Pause game"
                    disabled={r.counted}
                    onClick={pause}
                  >
                    <Icon name="pause" />
                  </button>
                  <button
                    className="icon"
                    aria-label="How to play"
                    onClick={() => open("tutorial")}
                  >
                    <Icon name="help" size={21} />
                  </button>
                </div>
              </header>
              <section className="scoreboard" aria-label="Scores">
                <div>
                  <span>Score</span>
                  <strong data-score>{number(r.score)}</strong>
                </div>
                <div>
                  <span>Best</span>
                  <strong className="best-number">{number(best)}</strong>
                </div>
                {r.chain > 1 ? (
                  <span
                    className="combo"
                    aria-label={`Combo multiplier ${Math.min(5, r.chain)}`}
                  >
                    ×{Math.min(5, r.chain)}
                  </span>
                ) : null}
                {ui.points ? (
                  <span
                    key={ui.feedbackId}
                    className="score-gain"
                    aria-live="polite"
                  >
                    +{number(ui.points)}
                    {ui.earned ? <small>+{ui.earned} undo</small> : null}
                  </span>
                ) : null}
              </section>
              <div className={"game-content " + (ended ? "run-end" : "")}>
                <Playfield
                  run={r}
                  paused={ui.paused || !!ui.modal}
                  onPlace={play}
                  onGesture={gesture}
                  flash={ui.flash}
                />
                {!ended ? (
                  <div className={ui.paused ? "concealed" : ""}>
                    <div className="undo-row">
                      <button
                        className="undo-button"
                        aria-label={`Undo, ${r.charges} charges`}
                        disabled={
                          !r.charges ||
                          !r.history.length ||
                          ui.paused ||
                          ui.settling
                        }
                        onClick={reverse}
                      >
                        <Icon name="undo" size={21} />
                        Undo <b>{r.charges}</b>
                      </button>
                      <div className="milestone">
                        <span>
                          {r.charges === 1
                            ? "Undo ready"
                            : `Next undo at ${number(nextUndo)}`}
                        </span>
                        <progress
                          max={MILESTONE}
                          value={Math.max(0, r.score - (nextUndo - MILESTONE))}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <section className="result-panel" aria-live="polite">
                    <h2>
                      {r.phase === "blocked" ? "No moves left" : "Run complete"}
                    </h2>
                    <p>
                      {r.phase === "blocked"
                        ? "Use an undo to try again, or end this run to save your score."
                        : `${number(r.score)} points · ${r.lines} lines cleared`}
                    </p>
                    <div>
                      {r.phase === "blocked" ? (
                        <>
                          <button className="primary" onClick={reverse}>
                            Undo · {r.charges}
                          </button>
                          <button className="secondary" onClick={endBlockedRun}>
                            End run
                          </button>
                        </>
                      ) : (
                        <button className="primary" onClick={requestNew}>
                          New game
                        </button>
                      )}
                    </div>
                    {r.phase === "blocked" ? (
                      <button className="text-button full" onClick={requestNew}>
                        New game
                      </button>
                    ) : null}
                  </section>
                )}
                {ui.dealError ? (
                  <div className="deal-error" role="alert">
                    <p>
                      Could not prepare the next pieces. Your board is saved.
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        ui.dealError = false;
                        ui.retry++;
                        render();
                      }}
                    >
                      Retry deal
                    </button>
                  </div>
                ) : null}
                {ui.paused && !r.counted ? (
                  <section className="pause-panel">
                    <Icon name="pause" size={28} />
                    <h2>Paused</h2>
                    <p>Your progress is saved.</p>
                    <button
                      className="primary full"
                      onClick={() => {
                        ui.paused = false;
                        clock.current = performance.now();
                        render();
                      }}
                    >
                      Resume
                    </button>
                    <button className="secondary full" onClick={requestNew}>
                      New game
                    </button>
                    <button
                      className="text-button full"
                      onClick={() => navigate("home")}
                    >
                      Home
                    </button>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
      {ui.modal ? (
        <Dialog
          title={
            ui.modal === "stats"
              ? "Statistics"
              : ui.modal === "settings"
                ? "Settings"
                : ui.modal === "new"
                  ? "Start a new game?"
                  : "How to play"
          }
          onClose={close}
        >
          {ui.modal === "stats" ? (
            <>
              <div className="stats-grid">
                {[
                  ["Best score", number(best)],
                  ["Finished runs", number(p.stats.runs)],
                  [
                    "Average score",
                    p.stats.runs
                      ? number(p.stats.totalScore / p.stats.runs)
                      : "-",
                  ],
                  [
                    "Lines cleared",
                    number(p.stats.lines + (r && !r.counted ? r.lines : 0)),
                  ],
                  [
                    "Longest chain",
                    number(
                      Math.max(
                        p.stats.bestChain,
                        r && !r.counted ? r.bestChain : 0,
                      ),
                    ),
                  ],
                  ["Playtime", duration(p.stats.playtime)],
                ].map(([label, value]) => (
                  <div className="stat" key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="subtle">
                Scores finish when a run ends or you start another. Playtime
                excludes menus and pauses.
              </p>
            </>
          ) : null}
          {ui.modal === "settings" ? (
            <SettingsPanel
              preferences={p.preferences}
              onPreference={preference}
              offline={offline}
              onRefresh={refreshApp}
              notice={ui.notice}
            />
          ) : null}
          {ui.modal === "tutorial" ? (
            <Tutorial
              onFinish={() => {
                preference("tutorialSeen", true);
                close();
                if (p.active && !p.active.counted) {
                  ui.screen = "game";
                  ui.paused = false;
                  clock.current = performance.now();
                  render();
                } else start();
              }}
            />
          ) : null}
          {ui.modal === "new" ? (
            <>
              <p>
                Continue your saved run, or discard it to start a fresh board.
                Your statistics are kept.
              </p>
              <button className="primary full" onClick={() => navigate("game")}>
                Continue run
              </button>
              <button className="secondary full" onClick={start}>
                Discard and start anew
              </button>
            </>
          ) : null}
        </Dialog>
      ) : null}
      <PortraitGuard onRotate={pause} />
    </main>
  );
}
