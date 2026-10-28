import {
  anyMove,
  CHARGE_CAP,
  HISTORY_LIMIT,
  MILESTONE,
  place,
  occupancy,
  SHAPE_BY_ID,
  verifyWitness,
  type Board,
  type Piece,
  type Deal,
} from "./blocks";
export interface Snapshot {
  board: Board;
  tray: (Piece | null)[];
  rng: number;
  score: number;
  chain: number;
  misses: number;
  lines: number;
  bestChain: number;
  moves: number;
}
export interface Run extends Snapshot {
  id: string;
  phase: "playing" | "dealing" | "blocked" | "finished";
  elapsed: number;
  charges: number;
  highwater: number;
  history: Snapshot[];
  deals: { key: string; deal: Deal }[];
  counted: boolean;
  revision: number;
}
export function resumable(run: Run | null): run is Run {
  return !!run && !run.counted && run.phase !== "finished" && run.moves > 0;
}
export function newRun(seed: number): Run {
  return {
    id: crypto.randomUUID(),
    board: Array(64).fill(0),
    tray: [null, null, null],
    rng: seed >>> 0 || 1,
    score: 0,
    chain: 0,
    misses: 0,
    lines: 0,
    bestChain: 0,
    moves: 0,
    phase: "dealing",
    elapsed: 0,
    charges: 0,
    highwater: 0,
    history: [],
    deals: [],
    counted: false,
    revision: 0,
  };
}
export function snapshot(r: Run): Snapshot {
  return structuredClone({
    board: r.board,
    tray: r.tray,
    rng: r.rng,
    score: r.score,
    chain: r.chain,
    misses: r.misses,
    lines: r.lines,
    bestChain: r.bestChain,
    moves: r.moves,
  });
}
export function dealKey(r: Run) {
  return occupancy(r.board).join(",") + "|" + r.rng;
}
export function acceptDeal(run: Run, deal: Deal): Run | null {
  if (
    run.phase !== "dealing" ||
    !verifyWitness(run.board, deal.tray, deal.witness) ||
    !Number.isInteger(deal.rng) ||
    deal.rng < 1 ||
    deal.rng > 4294967295
  )
    return null;
  const key = dealKey(run);
  return {
    ...run,
    tray: structuredClone(deal.tray),
    rng: deal.rng,
    phase: "playing",
    revision: run.revision + 1,
    deals: [
      ...run.deals.filter((d) => d.key !== key),
      { key, deal: structuredClone(deal) },
    ].slice(-4),
  };
}
export function commit(run: Run, slot: number, row: number, col: number) {
  if (
    run.phase !== "playing" ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 2 ||
    !run.tray[slot]
  )
    return null;
  const piece = run.tray[slot]!,
    result = place(run.board, piece, row, col);
  if (!result) return null;
  const r: Run = {
    ...run,
    board: result.board,
    tray: [...run.tray],
    history: [...run.history, snapshot(run)].slice(-HISTORY_LIMIT),
    moves: run.moves + 1,
    revision: run.revision + 1,
  };
  r.tray[slot] = null;
  if (result.lines) {
    r.chain++;
    r.misses = 0;
    r.bestChain = Math.max(r.bestChain, r.chain);
  } else {
    r.misses++;
    if (r.misses >= 3) r.chain = 0;
  }
  const points =
    SHAPE_BY_ID.get(piece.shape)!.count * 10 +
    100 * result.lines ** 2 * Math.min(5, r.chain);
  r.score += points;
  const awards = Math.max(
    0,
    Math.floor(r.score / MILESTONE) - Math.floor(r.highwater / MILESTONE),
  );
  r.charges = Math.min(CHARGE_CAP, r.charges + awards);
  r.highwater = Math.max(r.highwater, r.score);
  r.lines += result.lines;
  r.phase = r.tray.every((p) => p === null)
    ? "dealing"
    : anyMove(r.board, r.tray)
      ? "playing"
      : r.charges && r.history.length
        ? "blocked"
        : "finished";
  return {
    run: r,
    result,
    points,
    earned: Math.max(0, r.charges - run.charges),
  };
}
export function undo(run: Run): Run | null {
  if (run.counted || run.charges < 1 || !run.history.length) return null;
  const before = run.history.at(-1)!;
  return {
    ...run,
    ...structuredClone(before),
    history: run.history.slice(0, -1),
    charges: run.charges - 1,
    phase: "playing",
    revision: run.revision + 1,
  };
}
