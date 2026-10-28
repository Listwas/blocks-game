export const BOARD_SIZE = 8;
export const MILESTONE = 5000;
export const CHARGE_CAP = 1;
export const HISTORY_LIMIT = 3;
export interface Shape {
  id: string;
  cells: [number, number][];
  width: number;
  height: number;
  count: number;
}
function normalize(cells: [number, number][]): [number, number][] {
  const x = Math.min(...cells.map((c) => c[0])),
    y = Math.min(...cells.map((c) => c[1]));
  return cells
    .map((c) => [c[0] - x, c[1] - y] as [number, number])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
const key = (cells: [number, number][]) =>
  normalize(cells)
    .map((c) => c.join(","))
    .join(";");
function catalog(): Shape[] {
  const all = new Map<string, [number, number][]>();
  let previous: [number, number][][] = [[[0, 0]]];
  all.set("0,0", previous[0]);
  for (let size = 2; size <= 4; size++) {
    const next = new Map<string, [number, number][]>();
    for (const cells of previous)
      for (const [x, y] of cells)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (cells.some((c) => c[0] === x + dx && c[1] === y + dy)) continue;
          const n = normalize([...cells, [x + dx, y + dy]]);
          next.set(key(n), n);
        }
    previous = [...next.values()];
    for (const [k, v] of next) all.set(k, v);
  }
  const variants = (cells: [number, number][]) => {
    for (let i = 0; i < 4; i++) {
      const n = normalize(cells);
      all.set(key(n), n);
      cells = cells.map(([x, y]) => [-y, x]);
    }
  };
  variants([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ]);
  variants([
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [0, 2],
  ]);
  variants([
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
  ]);
  variants([
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ]);
  return [...all.values()]
    .map((c) => ({
      id: "s-" + key(c),
      cells: c,
      width: Math.max(...c.map((p) => p[0])) + 1,
      height: Math.max(...c.map((p) => p[1])) + 1,
      count: c.length,
    }))
    .sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}
export const SHAPES = catalog();
export const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));
export interface Piece {
  shape: string;
  color: number;
}
export type Board = number[];
export interface Step {
  slot: number;
  row: number;
  col: number;
}
export function validBoard(board: unknown): board is Board {
  return (
    Array.isArray(board) &&
    board.length === 64 &&
    board.every((c) => Number.isInteger(c) && c >= 0 && c <= 6)
  );
}
export function validPiece(p: unknown): p is Piece {
  return (
    !!p &&
    typeof p === "object" &&
    SHAPE_BY_ID.has((p as Piece).shape) &&
    Number.isInteger((p as Piece).color) &&
    (p as Piece).color >= 1 &&
    (p as Piece).color <= 6
  );
}
export function cellsAt(
  board: Board,
  piece: Piece,
  row: number,
  col: number,
): number[] | null {
  const s = SHAPE_BY_ID.get(piece.shape);
  if (
    !s ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    col < 0 ||
    row + s.height > 8 ||
    col + s.width > 8
  )
    return null;
  const ids = s.cells.map(([x, y]) => (row + y) * 8 + col + x);
  return ids.some((i) => board[i] !== 0) ? null : ids;
}
export function place(board: Board, piece: Piece, row: number, col: number) {
  const ids = cellsAt(board, piece, row, col);
  if (!ids) return null;
  const painted = [...board];
  for (const i of ids) painted[i] = piece.color;
  const rows: number[] = [],
    cols: number[] = [];
  for (let r = 0; r < 8; r++)
    if (painted.slice(r * 8, r * 8 + 8).every(Boolean)) rows.push(r);
  for (let c = 0; c < 8; c++)
    if (Array.from({ length: 8 }, (_, r) => painted[r * 8 + c]).every(Boolean))
      cols.push(c);
  const cleared = Array.from({ length: 64 }, (_, i) => i).filter(
      (i) => rows.includes(Math.floor(i / 8)) || cols.includes(i % 8),
    ),
    next = [...painted];
  for (const i of cleared) next[i] = 0;
  return {
    board: next,
    painted,
    ids,
    cleared,
    rows,
    cols,
    lines: rows.length + cols.length,
  };
}
export function placements(board: Board, piece: Piece): Step[] {
  const s = SHAPE_BY_ID.get(piece.shape);
  if (!s) return [];
  const out: Step[] = [];
  for (let r = 0; r <= 8 - s.height; r++)
    for (let c = 0; c <= 8 - s.width; c++)
      if (cellsAt(board, piece, r, c)) out.push({ slot: 0, row: r, col: c });
  return out;
}
export function anyMove(board: Board, tray: (Piece | null)[]) {
  return tray.some((piece) => {
    if (!piece) return false;
    const shape = SHAPE_BY_ID.get(piece.shape);
    if (!shape) return false;
    for (let row = 0; row <= 8 - shape.height; row++)
      for (let col = 0; col <= 8 - shape.width; col++)
        if (shape.cells.every(([x, y]) => board[(row + y) * 8 + col + x] === 0))
          return true;
    return false;
  });
}
export function occupancy(board: Board) {
  return Array.from({ length: 8 }, (_, r) =>
    board.slice(r * 8, r * 8 + 8).reduce((v, c, i) => v | (c ? 1 << i : 0), 0),
  );
}
export function clearedBoard(board: Board) {
  const rows = occupancy(board);
  return !rows.includes(255) && rows.reduce((a, b) => a & b, 255) === 0;
}
interface Mask {
  row: number;
  col: number;
  rows: number[];
}
const masks = new Map(
  SHAPES.map((s) => {
    const list: Mask[] = [];
    for (let r = 0; r <= 8 - s.height; r++)
      for (let c = 0; c <= 8 - s.width; c++) {
        const bits = Array(8).fill(0);
        s.cells.forEach(([x, y]) => (bits[r + y] |= 1 << (c + x)));
        list.push({ row: r, col: c, rows: bits });
      }
    return [s.id, list];
  }),
);
function addMask(board: number[], mask: Mask) {
  const next = board.map((v, i) => v | mask.rows[i]),
    cols = next.reduce((a, b) => a & b, 255);
  return next.map((v) => (v === 255 ? 0 : v & ~cols));
}
/** Independent occupancy-only search: does not use rendering, score or the intended player move. */
export function proveTray(board: Board, tray: Piece[], limit = 20000) {
  let nodes = 0,
    complete = true;
  const memo = new Set<string>();
  const search = (rows: number[], remaining: number[]): Step[] | null => {
    if (!remaining.length) return [];
    if (++nodes > limit) {
      complete = false;
      return null;
    }
    const state =
      rows.join(",") +
      "|" +
      remaining
        .map((i) => tray[i].shape)
        .sort()
        .join("/");
    if (memo.has(state)) return null;
    const seen = new Set<string>(),
      choices = remaining
        .map((slot) => ({
          slot,
          options: masks
            .get(tray[slot].shape)!
            .filter((p) => p.rows.every((v, r) => (v & rows[r]) === 0)),
        }))
        .sort((a, b) => a.options.length - b.options.length);
    for (const { slot, options } of choices) {
      if (seen.has(tray[slot].shape)) continue;
      seen.add(tray[slot].shape);
      for (const m of options) {
        const tail = search(
          addMask(rows, m),
          remaining.filter((i) => i !== slot),
        );
        if (tail) return [{ slot, row: m.row, col: m.col }, ...tail];
        if (!complete) return null;
      }
    }
    memo.add(state);
    return null;
  };
  const witness = search(
    occupancy(board),
    tray.map((_, i) => i),
  );
  return { playable: !!witness, witness: witness ?? [], nodes, complete };
}
export function verifyWitness(board: Board, tray: Piece[], witness: Step[]) {
  if (tray.length !== 3 || !tray.every(validPiece) || witness.length !== 3)
    return false;
  let current = board;
  const used = new Set<number>();
  for (const step of witness) {
    if (
      !Number.isInteger(step.slot) ||
      step.slot < 0 ||
      step.slot > 2 ||
      used.has(step.slot)
    )
      return false;
    const result = place(current, tray[step.slot], step.row, step.col);
    if (!result) return false;
    used.add(step.slot);
    current = result.board;
  }
  return true;
}
export function random(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9;
  return {
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    },
    get state() {
      return state >>> 0;
    },
  };
}
const buckets = [
  SHAPES.filter((s) => s.count <= 3),
  SHAPES.filter((s) => s.count === 4),
  SHAPES.filter((s) => s.count === 5 || s.count === 6),
  SHAPES.filter((s) => s.count === 9),
];
export interface Deal {
  tray: Piece[];
  rng: number;
  witness: Step[];
  fallback: boolean;
  attempts: number;
  nodes: number;
}
export function safeDeal(board: Board, seed: number): Deal {
  const rng = random(seed),
    single = SHAPES.find((s) => s.count === 1)!;
  const tray = Array.from({ length: 3 }, () => ({
    shape: single.id,
    color: 1 + Math.floor(rng.next() * 6),
  }));
  const proof = proveTray(board, tray);
  if (!proof.playable) throw Error("Cannot deal onto an invalid full board");
  return {
    tray,
    rng: rng.state,
    witness: proof.witness,
    fallback: true,
    attempts: 64,
    nodes: proof.nodes,
  };
}
export function dealTray(board: Board, seed: number): Deal {
  if (!validBoard(board) || !clearedBoard(board))
    throw Error("Invalid board for dealing");
  const rng = random(seed);
  let nodes = 0;
  for (let attempt = 1; attempt <= 64; attempt++) {
    const tray = Array.from({ length: 3 }, () => {
      const p = rng.next(),
        bucket = buckets[p < 0.3 ? 0 : p < 0.75 ? 1 : p < 0.95 ? 2 : 3],
        shape = bucket[Math.floor(rng.next() * bucket.length)];
      return { shape: shape.id, color: 1 + Math.floor(rng.next() * 6) };
    });
    const proof = proveTray(board, tray);
    nodes += proof.nodes;
    if (proof.playable)
      return {
        tray,
        rng: rng.state,
        witness: proof.witness,
        fallback: false,
        attempts: attempt,
        nodes,
      };
  }
  const fallback = safeDeal(board, rng.state);
  return { ...fallback, nodes: nodes + fallback.nodes };
}
