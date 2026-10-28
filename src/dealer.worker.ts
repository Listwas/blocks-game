import { dealTray, type Board, type Deal } from "./core/blocks";
export interface Request {
  id: number;
  runId: string;
  revision: number;
  board: Board;
  rng: number;
}
export type Response =
  | { id: number; runId: string; revision: number; deal: Deal }
  | { id: number; runId: string; revision: number; error: string };
self.onmessage = (e: MessageEvent<Request>) => {
  try {
    self.postMessage({
      id: e.data.id,
      runId: e.data.runId,
      revision: e.data.revision,
      deal: dealTray(e.data.board, e.data.rng),
    } satisfies Response);
  } catch {
    self.postMessage({
      id: e.data.id,
      runId: e.data.runId,
      revision: e.data.revision,
      error: "Could not prepare pieces.",
    } satisfies Response);
  }
};
