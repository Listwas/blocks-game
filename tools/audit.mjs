import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["src/core/blocks.ts", "src/core/run.ts"],
  outdir: "/tmp/blocks-audit",
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
});
const core = await import("/tmp/blocks-audit/blocks.mjs"),
  runs = await import("/tmp/blocks-audit/run.mjs");
const {
  dealTray,
  verifyWitness,
  random,
  SHAPE_BY_ID,
  placements,
  place,
  clearedBoard,
} = core;
const cases = [],
  timings = [],
  byGroup = {};
let fallback = 0;
for (let i = 0; i < 10000; i++) {
  const rng = random(i + 123),
    group = i < 1000 ? "opening" : i < 8000 ? "crowded" : "adversarial";
  let board = Array.from({ length: 64 }, () =>
    group === "opening"
      ? 0
      : rng.next() < (group === "adversarial" ? 0.9 : 0.25 + (i % 65) / 100)
        ? 1 + Math.floor(rng.next() * 6)
        : 0,
  );
  if (group === "adversarial" && i % 2 === 0)
    board = Array.from({ length: 64 }, (_, j) =>
      Math.floor(j / 8) === j % 8 ? 0 : 1,
    );
  const rows = Array.from({ length: 8 }, (_, r) =>
      board.slice(r * 8, r * 8 + 8).every(Boolean),
    ),
    cols = Array.from({ length: 8 }, (_, c) =>
      Array.from({ length: 8 }, (_, r) => board[r * 8 + c]).every(Boolean),
    );
  board = board.map((v, j) => (rows[Math.floor(j / 8)] || cols[j % 8] ? 0 : v));
  const start = performance.now(),
    deal = dealTray(board, i + 991);
  timings.push(performance.now() - start);
  if (!verifyWitness(board, deal.tray, deal.witness))
    throw Error("Unplayable tray");
  fallback += +deal.fallback;
  byGroup[group] ??= { count: 0, fallback: 0 };
  byGroup[group].count++;
  byGroup[group].fallback += +deal.fallback;
  cases.push({
    board,
    pieces: deal.tray.map((p) => SHAPE_BY_ID.get(p.shape).cells),
    witness: deal.witness,
  });
  if ((i + 1) % 2000 === 0) console.log("Verified", i + 1, "random trays");
}
await writeFile("/tmp/blocks-tray-audit.json", JSON.stringify(cases));
const proof = spawnSync(
  "python3",
  ["tools/independent_audit.py", "/tmp/blocks-tray-audit.json"],
  { stdio: "inherit" },
);
if (proof.status) process.exit(proof.status);
const results = {};
for (const strategy of ["random", "greedy", "conservative"]) {
  const games = [];
  for (let game = 0; game < 60; game++) {
    let r = runs.newRun(100 + game);
    const rand = random(4321 + game);
    let rewards = 0,
      undos = 0,
      firstReward = 0,
      fallbacks = 0;
    const start = performance.now();
    for (let turn = 0; turn < 1200; turn++) {
      if (r.phase === "dealing") {
        const deal = dealTray(r.board, r.rng);
        fallbacks += +deal.fallback;
        r = runs.acceptDeal(r, deal);
      }
      if (r.phase === "finished") break;
      if (r.phase === "blocked") {
        const prev = runs.undo(r);
        if (!prev) break;
        r = prev;
        undos++;
        continue;
      }
      const options = [];
      for (let slot = 0; slot < 3; slot++) {
        const p = r.tray[slot];
        if (!p) continue;
        for (const a of placements(r.board, p)) {
          const after = place(r.board, p, a.row, a.col);
          const filled = after.board.filter(Boolean).length;
          let holes = 0;
          for (let j = 0; j < 64; j++)
            if (!after.board[j]) {
              let free = 0;
              for (const d of [-8, 8, -1, 1]) {
                const q = j + d;
                if (
                  q >= 0 &&
                  q < 64 &&
                  (Math.abs(d) === 8 ||
                    Math.floor(q / 8) === Math.floor(j / 8)) &&
                  !after.board[q]
                )
                  free++;
              }
              if (!free) holes++;
            }
          let value =
            strategy === "greedy"
              ? after.lines * 1000 - filled
              : after.lines * 1000 - filled - holes * 30;
          options.push({ slot, row: a.row, col: a.col, value });
        }
      }
      if (!options.length) throw Error("Run should detect blockage");
      const chosen =
        strategy === "random"
          ? options[Math.floor(rand.next() * options.length)]
          : options.sort((a, b) => b.value - a.value)[0];
      const event = runs.commit(r, chosen.slot, chosen.row, chosen.col);
      r = event.run;
      rewards += Math.max(0, event.earned);
      if (rewards && !firstReward) firstReward = r.moves;
    }
    games.push({
      score: r.score,
      moves: r.moves,
      chain: r.bestChain,
      rewards,
      undos,
      firstReward,
      fallbacks,
      capped: r.phase !== "finished",
      ms: performance.now() - start,
    });
  }
  const values = (key) => games.map((g) => g[key]).sort((a, b) => a - b),
    median = (key) => values(key)[Math.floor(games.length / 2)];
  results[strategy] = {
    games: games.length,
    medianScore: median("score"),
    medianMoves: median("moves"),
    medianFirstRewardMove: median("firstReward"),
    medianRewards: median("rewards"),
    medianChain: median("chain"),
    capped: games.filter((g) => g.capped).length,
    fallbacks: games.reduce((s, g) => s + g.fallbacks, 0),
  };
  console.log(strategy, results[strategy]);
}
timings.sort((a, b) => a - b);
const report = {
  trays: 10000,
  groups: byGroup,
  totalFallbacks: fallback,
  p95: timings[Math.floor(timings.length * 0.95)],
  max: timings.at(-1),
  strategies: results,
};
await writeFile("docs/audit.json", JSON.stringify(report, null, 2) + "\n");
console.log("Audit report:", report);
