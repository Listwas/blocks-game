import { SaveScheduler } from "./saveScheduler";
import {
  validBoard,
  validPiece,
  clearedBoard,
  anyMove,
  type Deal,
} from "./blocks";
import { type Run, type Snapshot } from "./run";
export interface Preferences {
  theme: "system" | "light" | "dark";
  reduceMotion: boolean;
  effects: boolean;
  effectsVolume: number;
  tutorialSeen: boolean;
}

export interface Stats {
  best: number;
  runs: number;
  totalScore: number;
  lines: number;
  bestChain: number;
  playtime: number;
}
export interface Profile {
  version: 1;
  active: Run | null;
  preferences: Preferences;
  stats: Stats;
}
export function freshProfile(): Profile {
  return {
    version: 1,
    active: null,
    preferences: {
      theme: "system",
      reduceMotion: false,
      effects: true,
      effectsVolume: 1,
      tutorialSeen: false,
    },
    stats: {
      best: 0,
      runs: 0,
      totalScore: 0,
      lines: 0,
      bestChain: 0,
      playtime: 0,
    },
  };
}
export function addTime(p: Profile, delta: number) {
  if (p.active && p.active.phase !== "finished" && delta > 0) {
    p.active.elapsed += delta;
    p.stats.playtime += delta;
  }
}
export function discardUnstarted(p: Profile) {
  if (p.active && !p.active.counted && p.active.moves === 0) p.active = null;
}
export function finalize(p: Profile) {
  const r = p.active;
  if (!r || r.counted) return;
  if (r.moves > 0) {
    p.stats.best = Math.max(p.stats.best, r.score);
    p.stats.runs++;
    p.stats.totalScore += r.score;
    p.stats.lines += r.lines;
    p.stats.bestChain = Math.max(p.stats.bestChain, r.bestChain);
  }
  r.counted = true;
  r.phase = "finished";
}
const whole = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Snapshot;
  return (
    validBoard(s.board) &&
    clearedBoard(s.board) &&
    Array.isArray(s.tray) &&
    s.tray.length === 3 &&
    s.tray.every((p) => p === null || validPiece(p)) &&
    whole(s.rng) &&
    s.rng > 0 &&
    s.rng <= 4294967295 &&
    [s.score, s.chain, s.misses, s.lines, s.bestChain, s.moves].every(whole) &&
    s.bestChain >= s.chain
  );
}
export function validRun(value: unknown): value is Run {
  if (!validSnapshot(value)) return false;
  const r = value as Run;
  if (
    typeof r.id !== "string" ||
    !["playing", "dealing", "blocked", "finished"].includes(r.phase) ||
    !Number.isFinite(r.elapsed) ||
    r.elapsed < 0 ||
    !whole(r.charges) ||
    r.charges > 3 ||
    !whole(r.highwater) ||
    r.highwater < r.score ||
    !whole(r.revision) ||
    typeof r.counted !== "boolean" ||
    !Array.isArray(r.history) ||
    r.history.length > 3 ||
    !r.history.every(validSnapshot) ||
    !Array.isArray(r.deals) ||
    r.deals.length > 4
  )
    return false;
  if (
    r.history.some(
      (s, i) =>
        s.moves >= r.moves || (i > 0 && s.moves <= r.history[i - 1].moves),
    )
  )
    return false;
  if (r.phase === "dealing" && !r.tray.every((p) => p === null)) return false;
  if (r.phase === "playing" && !anyMove(r.board, r.tray)) return false;
  if (
    r.phase === "blocked" &&
    (anyMove(r.board, r.tray) || !r.charges || !r.history.length)
  )
    return false;
  return r.deals.every(
    (cache) =>
      typeof cache.key === "string" &&
      cache.deal &&
      Array.isArray(cache.deal.tray) &&
      cache.deal.tray.length === 3 &&
      cache.deal.tray.every(validPiece) &&
      whole(cache.deal.rng) &&
      cache.deal.rng > 0 &&
      Array.isArray(cache.deal.witness) &&
      cache.deal.witness.length === 3 &&
      cache.deal.witness.every(
        (s) =>
          [s.slot, s.row, s.col].every(whole) &&
          s.slot < 3 &&
          s.row < 8 &&
          s.col < 8,
      ),
  );
}
export function validateProfile(value: unknown): Profile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Profile;
  if (
    p.version !== 1 ||
    !p.preferences ||
    !p.stats ||
    !(p.active === null || validRun(p.active))
  )
    return null;
  const pref = p.preferences;
  for (const k of ["reduceMotion", "effects", "tutorialSeen"] as const)
    if (typeof pref[k] !== "boolean") return null;
  if (
    !["system", "light", "dark"].includes(pref.theme) ||
    !Number.isFinite(pref.effectsVolume) ||
    pref.effectsVolume < 0 ||
    pref.effectsVolume > 1
  )
    return null;
  if (
    ![
      p.stats.best,
      p.stats.runs,
      p.stats.totalScore,
      p.stats.lines,
      p.stats.bestChain,
    ].every(whole) ||
    !Number.isFinite(p.stats.playtime) ||
    p.stats.playtime < 0
  )
    return null;
  return {
    ...p,
    active: p.active
      ? { ...p.active, charges: Math.min(1, p.active.charges) }
      : null,
    preferences: {
      theme: pref.theme,
      reduceMotion: pref.reduceMotion,
      effects: pref.effects,
      effectsVolume: pref.effectsVolume,
      tutorialSeen: pref.tutorialSeen,
    },
  };
}

export class ProfileStore {
  db: IDBDatabase | null = null;
  notice = "";
  private writer = new SaveScheduler<Profile>((copy) => this.write(copy));
  flush() {
    return this.writer.flush();
  }
  async open(): Promise<Profile> {
    try {
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("blocks-profile", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("profile");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const tx = this.db!.transaction("profile", "readonly"),
          s = tx.objectStore("profile"),
          a = s.get("current"),
          b = s.get("backup");
        tx.oncomplete = () => resolve([a.result, b.result]);
        tx.onerror = () => reject(tx.error);
      });
      if (values[0] === undefined) return freshProfile();
      const current = validateProfile(values[0]);
      if (current) {
        discardUnstarted(current);
        await this.save(current);
        return current;
      }
      const backup = validateProfile(values[1]);
      this.notice = backup
        ? "Your save was recovered from its backup."
        : "Your save could not be read. A fresh profile is in use.";
      if (backup) {
        discardUnstarted(backup);
        await this.save(backup);
      }
      return backup ?? freshProfile();
    } catch {
      this.notice =
        "Saving is unavailable. Keep this tab open to retain your progress.";
      return freshProfile();
    }
  }
  save(profile: Profile) {
    return this.writer.save(profile);
  }
  private write(copy: Profile): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Storage unavailable"));
        return;
      }
      const tx = this.db.transaction("profile", "readwrite"),
        s = tx.objectStore("profile");
      const old = s.get("current");
      old.onsuccess = () => {
        if (validateProfile(old.result)) s.put(old.result, "backup");
        s.put(copy, "current");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
