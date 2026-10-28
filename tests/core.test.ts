import { describe, it, expect } from "vitest";
import {
  SHAPES,
  SHAPE_BY_ID,
  cellsAt,
  place,
  dealTray,
  proveTray,
  verifyWitness,
  safeDeal,
  type Piece,
} from "../src/core/blocks";
import { newRun, acceptDeal, commit, undo } from "../src/core/run";
import {
  freshProfile,
  finalize,
  addTime,
  validateProfile,
} from "../src/core/profile";
const empty = () => Array(64).fill(0),
  single: Piece = { shape: SHAPES.find((s) => s.count === 1)!.id, color: 1 };
const square: Piece = {
  shape: SHAPES.find((s) => s.width === 3 && s.height === 3 && s.count === 9)!
    .id,
  color: 2,
};
function started(seed = 42) {
  const r = newRun(seed);
  return acceptDeal(r, dealTray(r.board, r.rng))!;
}
describe("board and shapes", () => {
  it("contains37 fixed shapes in the promised buckets", () => {
    expect(SHAPES.length).toBe(37);
    expect(SHAPES.filter((s) => s.count <= 3).length).toBe(9);
    expect(SHAPES.filter((s) => s.count === 4).length).toBe(19);
    expect(SHAPES.filter((s) => [5, 6].includes(s.count)).length).toBe(8);
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(37);
  });
  it("rejects edge overflow, collision, fractional anchors", () => {
    expect(cellsAt(empty(), square, 6, 6)).toBeNull();
    expect(cellsAt(empty(), single, -1, 0)).toBeNull();
    expect(cellsAt(empty(), single, 0, 0.5)).toBeNull();
    const b = empty();
    b[0] = 1;
    expect(cellsAt(b, single, 0, 0)).toBeNull();
    expect(cellsAt(b, single, 7, 7)).toEqual([63]);
  });
  it("clears crossing rows and columns simultaneously without double-removal", () => {
    const b = empty();
    for (let i = 1; i < 8; i++) {
      b[i] = 1;
      b[i * 8] = 2;
    }
    const p = place(b, single, 0, 0)!;
    expect(p.lines).toBe(2);
    expect(p.cleared.length).toBe(15);
    expect(p.board.every((v) => !v)).toBe(true);
    expect(b[0]).toBe(0);
  });
  it("keeps unsupported blocks in place, with no gravity", () => {
    const b = empty();
    b[63] = 2;
    const next = place(b, single, 0, 0)!;
    expect(next.board[63]).toBe(2);
  });
});
describe("fair deterministic dealing", () => {
  it("proves all3pieces including clears between placements", () => {
    const b = empty();
    for (let i = 1; i < 64; i++) if (i % 9 !== 0) b[i] = 1;
    const d = safeDeal(b, 1);
    expect(verifyWitness(b, d.tray, d.witness)).toBe(true);
    expect(proveTray(b, [square, square, square]).playable).toBe(false);
  });
  it("never calls a budget-limited search a proof", () => {
    const proof = proveTray(empty(), [square, square, square], 0);
    expect(proof.playable).toBe(false);
    expect(proof.complete).toBe(false);
  });
  it("restores deterministic pieces, colors, and random progression", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = dealTray(empty(), seed),
        b = dealTray(empty(), seed);
      expect(a).toEqual(b);
      expect(verifyWitness(empty(), a.tray, a.witness)).toBe(true);
    }
  });
  it("rejects a stale deal or invalid witness", () => {
    const r = newRun(42),
      d = dealTray(r.board, r.rng);
    expect(acceptDeal({ ...r, phase: "playing" }, d)).toBeNull();
    expect(acceptDeal(r, { ...d, witness: [] })).toBeNull();
  });
});
describe("score, combos and earned undo", () => {
  it("scores10per square and100per line", () => {
    const r = started();
    r.tray = [single, single, single];
    for (let i = 1; i < 8; i++) r.board[i] = 2;
    const event = commit(r, 0, 0, 0)!;
    expect(event.points).toBe(110);
    expect(event.run.chain).toBe(1);
    expect(event.run.lines).toBe(1);
  });
  it("scores simultaneous lines quadratically and caps multiplier at5", () => {
    const r = started();
    r.tray = [single, single, single];
    r.chain = 20;
    r.bestChain = 20;
    for (let i = 1; i < 8; i++) {
      r.board[i] = 1;
      r.board[i * 8] = 2;
    }
    expect(commit(r, 0, 0, 0)!.points).toBe(2010);
  });
  it("resets combo after three misses but permits two between clears", () => {
    let r = started();
    r.tray = [single, single, single];
    r.chain = 2;
    r.bestChain = 2;
    r = commit(r, 0, 0, 0)!.run;
    r = commit(r, 1, 0, 1)!.run;
    expect(r.chain).toBe(2);
    r = commit(r, 2, 0, 2)!.run;
    expect(r.chain).toBe(0);
    expect(r.phase).toBe("dealing");
  });
  it("awards milestone charges only once, including undo/replay", () => {
    const r = started();
    r.tray = [single, single, single];
    r.score = 4990;
    r.highwater = 4990;
    const first = commit(r, 0, 0, 0)!.run;
    expect(first.charges).toBe(1);
    const previous = undo(first)!;
    expect(previous.score).toBe(4990);
    expect(previous.charges).toBe(0);
    expect(previous.highwater).toBe(5000);
    const again = commit(previous, 0, 0, 0)!.run;
    expect(again.charges).toBe(0);
  });
  it("caps charges at1 across large awards", () => {
    const r = started();
    r.tray = [single, single, single];
    r.charges = 3;
    r.score = 999;
    r.highwater = 999;
    expect(commit(r, 0, 0, 0)!.run.charges).toBe(1);
  });
  it("restores the exact old tray and random state across a refill", () => {
    let r = started();
    r.tray = [single, single, single];
    r.charges = 3;
    r = commit(r, 0, 0, 0)!.run;
    r = commit(r, 1, 0, 1)!.run;
    const before = structuredClone(r);
    r = commit(r, 2, 0, 2)!.run;
    const deal = dealTray(r.board, r.rng);
    r = acceptDeal(r, deal)!;
    const restored = undo(r)!;
    expect(restored.board).toEqual(before.board);
    expect(restored.tray).toEqual(before.tray);
    expect(restored.rng).toBe(before.rng);
    expect(restored.deals.at(-1)!.deal).toEqual(deal);
    expect(restored.charges).toBe(0);
  });
  it("does not rewind playtime and keeps only3undo snapshots", () => {
    let r = started();
    r.charges = 3;
    for (let i = 0; i < 5; i++) {
      r.tray = [single, single, single];
      r = commit(r, 0, 0, i)!.run;
    }
    r.elapsed = 10000;
    expect(r.history.length).toBe(3);
    expect(undo(r)!.elapsed).toBe(10000);
  });
  it("makes illegal placements pure no-ops", () => {
    const r = started();
    expect(commit(r, -1, 0, 0)).toBeNull();
    expect(commit(r, 0, -1, 0)).toBeNull();
  });
});
describe("persistence and results", () => {
  it("finalizes results once, including an abandoned played run", () => {
    const p = freshProfile();
    p.active = started();
    p.active.moves = 1;
    p.active.score = 800;
    p.active.highwater = 800;
    p.active.lines = 3;
    p.active.bestChain = 2;
    addTime(p, 1000);
    finalize(p);
    finalize(p);
    expect(p.stats).toEqual({
      best: 800,
      runs: 1,
      totalScore: 800,
      lines: 3,
      bestChain: 2,
      playtime: 1000,
    });
  });
  it("ends a blocked run with undo available, records its score once, and prevents further undo", () => {
    const p = freshProfile();
    const r = started();
    r.board = Array.from({ length: 64 }, (_, i) =>
      Math.floor(i / 8) === i % 8 || (Math.floor(i / 8) + 4) % 8 === i % 8
        ? 0
        : 1,
    );
    const bar = SHAPES.find((s) => s.count === 2 && s.width === 2)!;
    r.tray = [single, { shape: bar.id, color: 2 }, null];
    r.charges = 1;
    p.active = commit(r, 0, 0, 0)!.run;
    expect(p.active.phase).toBe("blocked");
    expect(undo(p.active)).not.toBeNull();
    const before = structuredClone(p.active);
    finalize(p);
    expect(p.active.phase).toBe("finished");
    expect(p.active.counted).toBe(true);
    expect(p.active.board).toEqual(before.board);
    expect(p.active.score).toBe(before.score);
    expect(p.stats.runs).toBe(1);
    expect(p.stats.totalScore).toBe(before.score);
    expect(undo(p.active)).toBeNull();
    expect(validateProfile(p)).not.toBeNull();
    finalize(p);
    expect(p.stats.runs).toBe(1);
  });
  it("does not invent results for an untouched run", () => {
    const p = freshProfile();
    p.active = started();
    finalize(p);
    expect(p.stats.runs).toBe(0);
  });
  it("validates complete snapshots and rejects corrupted profiles", () => {
    const p = freshProfile();
    p.active = started();
    expect(validateProfile(p)).toEqual(p);
    for (const patch of [
      { board: [0] },
      { rng: 0 },
      { charges: 4 },
      { highwater: -1 },
      { tray: [] },
      { phase: "blocked" },
      { elapsed: NaN },
    ])
      expect(
        validateProfile({ ...p, active: { ...p.active, ...patch } }),
      ).toBeNull();
  });
});

it("migrates old undo charges without losing the claimed highwater", () => {
  const p = freshProfile();
  const r = newRun(17);
  r.phase = "dealing";
  r.charges = 3;
  r.highwater = 17000;
  p.active = r;
  const loaded = validateProfile(p)!;
  expect(loaded.active!.charges).toBe(1);
  expect(loaded.active!.highwater).toBe(17000);
  expect(loaded.stats).toEqual(p.stats);
});

it("consumes milestones crossed while an undo is already stored", () => {
  const r = started();
  r.tray = [single, single, single];
  r.score = 4990;
  r.highwater = 4990;
  r.charges = 1;
  const crossed = commit(r, 0, 0, 0)!;
  expect(crossed.earned).toBe(0);
  expect(crossed.run.charges).toBe(1);
  const restored = undo(crossed.run)!;
  const profile = freshProfile();
  profile.active = restored;
  const reloaded = validateProfile(structuredClone(profile))!.active!;
  expect(commit(reloaded, 0, 0, 0)!.run.charges).toBe(0);
  reloaded.score = 9990;
  reloaded.highwater = 9990;
  expect(commit(reloaded, 0, 0, 0)!.run.charges).toBe(1);
});

it("only runs with progress can be continued; empty cleanup preserves statistics", async () => {
  const { resumable } = await import("../src/core/run");
  const { discardUnstarted } = await import("../src/core/profile");
  const p = freshProfile();
  p.stats.runs = 7;
  p.stats.totalScore = 1234;
  p.active = started();
  expect(resumable(p.active)).toBe(false);
  discardUnstarted(p);
  expect(p.active).toBeNull();
  expect(p.stats.runs).toBe(7);
  expect(p.stats.totalScore).toBe(1234);
  const r = started();
  const first = r.deals[0].deal.witness[0];
  p.active = commit(r, first.slot, first.row, first.col)!.run;
  expect(resumable(p.active)).toBe(true);
  discardUnstarted(p);
  expect(p.active).not.toBeNull();
  finalize(p);
  expect(resumable(p.active)).toBe(false);
  finalize(p);
  expect(p.stats.runs).toBe(8);
});

it("checks remaining pieces on the cleared board, including simultaneous row and column clears", () => {
  const bar: Piece = {
    shape: SHAPES.find((s) => s.width === 2 && s.height === 1)!.id,
    color: 2,
  };
  const r = newRun(53);
  r.board = Array.from({ length: 64 }, (_, i) =>
    Math.floor(i / 8) === i % 8 ? 0 : 1,
  );
  r.phase = "playing";
  r.tray = [single, bar, bar];
  const event = commit(r, 0, 7, 7)!;
  expect(event.result.lines).toBe(2);
  expect(event.run.board.slice(56)).toEqual(Array(8).fill(0));
  expect(event.run.phase).toBe("playing");
  expect(commit(event.run, 1, 7, 0)).not.toBeNull();
  r.tray = [null, null, single];
  const last = commit(r, 2, 7, 7)!;
  expect(last.result.lines).toBe(2);
  expect(last.run.phase).toBe("dealing");
  expect(last.run.counted).toBe(false);
});

it("short-circuit move detection agrees with exhaustive placements", async () => {
  const { anyMove, placements, random } = await import("../src/core/blocks");
  const rng = random(1235);
  for (let sample = 0; sample < 12; sample++) {
    const board = Array.from({ length: 64 }, () =>
      rng.next() < sample / 12 ? 1 : 0,
    );
    for (const shape of SHAPES) {
      const piece = { shape: shape.id, color: 1 };
      expect(anyMove(board, [null, piece, null])).toBe(
        placements(board, piece).length > 0,
      );
    }
  }
});
