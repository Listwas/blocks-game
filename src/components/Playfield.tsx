import { InputFrames } from "../inputFrames";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cellsAt,
  placements,
  place,
  SHAPE_BY_ID,
  type Piece,
} from "../core/blocks";
import type { Run } from "../core/run";
export interface ClearFlash {
  id: number;
  cells: { index: number; color: number }[];
}
interface Preview {
  slot: number;
  row: number;
  col: number;
}
interface Drag {
  slot: number;
  pointer: number;
  startX: number;
  startY: number;
  gripX: number;
  gripY: number;
  touch: boolean;
  moved: boolean;
  fromBoard: boolean;
  wasSelected: boolean;
}
export const PieceView = memo(function PieceView({
  piece,
  tile = 16,
  gap = 3,
}: {
  piece: Piece;
  tile?: number;
  gap?: number;
}) {
  const shape = SHAPE_BY_ID.get(piece.shape)!;
  return (
    <span
      className="piece-art"
      style={{
        gridTemplateColumns: `repeat(${shape.width},${tile}px)`,
        gridTemplateRows: `repeat(${shape.height},${tile}px)`,
        gap,
      }}
      aria-hidden="true"
    >
      {shape.cells.map(([x, y]) => (
        <i
          key={x + "," + y}
          className={"block color-" + piece.color}
          style={{ gridColumn: x + 1, gridRow: y + 1 }}
        />
      ))}
    </span>
  );
});

export const Playfield = memo(function Playfield({
  run,
  paused,
  onPlace,
  onGesture,
  flash,
}: {
  run: Run;
  paused: boolean;
  onPlace: (slot: number, row: number, col: number) => boolean;
  onGesture: () => void;
  flash: ClearFlash | null;
}) {
  const [frames] = useState(() => new InputFrames());
  const ghostElement = useRef<HTMLDivElement>(null);
  const geometry = useRef<DOMRect | null>(null);
  const grid = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    contacts = useRef(new Set<number>()),
    multi = useRef(false);
  const [selected, setSelected] = useState<number | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [ghost, setGhost] = useState<{ x: number; y: number; slot: number } | null>(
      null,
    ),
    [size, setSize] = useState(360),
    [trayTile, setTrayTile] = useState(16),
    [message, setMessage] = useState("");
  const gap = 3,
    padding = 8,
    // Whole CSS-pixel cells avoid uneven, softened edges on desktop.
    density = window.devicePixelRatio || 1,
    step = Math.max(
      1,
      Math.floor(((size - 2 * padding + gap) / 8) * density) / density,
    ),
    tile = step - gap;
  const enabled = !paused && run.phase === "playing";
  const reset = () => {
    frames.cancel();
    drag.current = null;
    geometry.current = null;
    setGhost(null);
    setPreview(null);
    setSelected(null);
  };
  useLayoutEffect(() => {
    const el = root.current!;

    const content = el.closest<HTMLElement>(".game-content");
    let measuredSize = -1;
    const measure = () => {
      const viewport = el.closest<HTMLElement>(".game-viewport")!;
      const group = viewport.querySelector<HTMLElement>(".game-group")!;
      const overhead = group.offsetHeight - grid.current!.offsetHeight;
      const height = viewport.clientHeight - overhead - 4;
      const next = Math.min(el.clientWidth, Math.max(160, height));
      geometry.current = null;
      setTrayTile(
        Math.max(10, Math.min(19, Math.floor((el.clientWidth / 3 - 24) / 5))),
      );
      if (Math.abs(measuredSize - next) < 0.5) return;
      measuredSize = next;
      setSize(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(el.closest<HTMLElement>(".game-viewport")!);
    if (content) observer.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      frames.cancel();
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useLayoutEffect(() => {
    reset();
    contacts.current.clear();
    multi.current = false;
  }, [paused, run.id, run.revision]);
  useEffect(() => {
    const cancel = () => {
      contacts.current.clear();
      multi.current = false;
      reset();
    };
    // A second finger outside the playfield must cancel the first drag too.
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      contacts.current.add(e.pointerId);
      if (contacts.current.size > 1) {
        multi.current = true;
        reset();
      }
    };
    const release = (e: PointerEvent) => {
      contacts.current.delete(e.pointerId);
      if (!contacts.current.size) multi.current = false;
    };
    window.addEventListener("pointerdown", touchDown, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("pointerdown", touchDown, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);
  const rawAnchor = (x: number, y: number) => {
    const rect = (geometry.current ??= grid.current!.getBoundingClientRect());
    return {
      row: Math.floor((y - rect.top - padding) / step),
      col: Math.floor((x - rect.left - padding) / step),
    };
  };
  const project = (d: Drag, x: number, y: number) => {
    if (d.fromBoard) return { ...rawAnchor(x, y), slot: d.slot };
    const piece = run.tray[d.slot]!,
      s = SHAPE_BY_ID.get(piece.shape)!,
      w = s.width * step - gap,
      h = s.height * step - gap,
      lift = d.touch ? Math.max(44, Math.min(72, step * 1.25)) : 0;
    const gx = x - w * d.gripX,
      gy = y - h * d.gripY - lift,
      rect = (geometry.current ??= grid.current!.getBoundingClientRect());
    return {
      slot: d.slot,
      row: Math.round((gy - rect.top - padding) / step),
      col: Math.round((gx - rect.left - padding) / step),
      gx,
      gy,
    };
  };
  const confirm = (p: Preview) => {
    const piece = run.tray[p.slot];
    if (!piece || !cellsAt(run.board, piece, p.row, p.col)) {
      setMessage("That space does not fit this piece.");
      reset();
      return;
    }
    const ok = onPlace(p.slot, p.row, p.col);
    if (ok) setMessage("Piece placed.");
    reset();
  };
  const down = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    contacts.current.add(e.pointerId);
    if (contacts.current.size > 1) {
      multi.current = true;
      reset();
      return;
    }
    onGesture();
    const target = e.target as HTMLElement,
      slotEl = target.closest<HTMLElement>("[data-slot]"),
      cellEl = target.closest<HTMLElement>("[data-cell]");
    if (!slotEl && !cellEl) return;
    let slot = selected,
      fromBoard = !!cellEl;
    if (slotEl) slot = Number(slotEl.dataset.slot);
    if (slot === null || !run.tray[slot]) return;
    geometry.current = grid.current!.getBoundingClientRect();
    let gripX = 0.5,
      gripY = 0.5;
    if (slotEl) {
      const art = slotEl.querySelector(".piece-art")!.getBoundingClientRect();
      if (
        e.clientX >= art.left &&
        e.clientX <= art.right &&
        e.clientY >= art.top &&
        e.clientY <= art.bottom
      ) {
        gripX = (e.clientX - art.left) / art.width;
        gripY = (e.clientY - art.top) / art.height;
      }
    }
    const wasSelected = selected === slot;
    setSelected(slot);
    drag.current = {
      slot,
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      gripX,
      gripY,
      touch: e.pointerType === "touch",
      moved: false,
      fromBoard,
      wasSelected,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (fromBoard) setPreview({ ...rawAnchor(e.clientX, e.clientY), slot });
  };
  const updatePreview = (p: Preview) =>
    setPreview((old) =>
      old?.slot === p.slot && old.row === p.row && old.col === p.col ? old : p,
    );
  const move = (e: React.PointerEvent) => {
    if (!enabled || multi.current) return;
    const { clientX: x, clientY: y, pointerId, pointerType } = e;
    if (!drag.current && !(selected !== null && pointerType === "mouse"))
      return;
    frames.request(() => {
      const d = drag.current;
      if (d && d.pointer === pointerId) {
        if (Math.hypot(x - d.startX, y - d.startY) > 5) d.moved = true;
        if (!d.moved && !d.fromBoard) return;
        const p = project(d, x, y);
        updatePreview(p);
        if (
          !d.fromBoard &&
          "gx" in p &&
          typeof p.gx === "number" &&
          typeof p.gy === "number"
        ) {
          if (ghostElement.current)
            ghostElement.current.style.transform = `translate(${p.gx}px, ${p.gy}px)`;
          else setGhost({ x: p.gx, y: p.gy, slot: d.slot });
        }
      } else if (selected !== null && pointerType === "mouse")
        updatePreview({ ...rawAnchor(x, y), slot: selected });
    });
  };
  const up = (e: React.PointerEvent) => {
    contacts.current.delete(e.pointerId);
    const d = drag.current;
    if (multi.current) {
      if (!contacts.current.size) multi.current = false;
      return;
    }
    if (!d || d.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5)
      d.moved = true;
    if (d.fromBoard || d.moved) confirm(project(d, e.clientX, e.clientY));
    else {
      setSelected(d.wasSelected ? null : d.slot);
      setMessage(d.wasSelected ? "Selection cancelled." : "Piece selected.");
      drag.current = null;
      setGhost(null);
    }
  };
  const keyboardSelect = (slot: number) => {
    if (!enabled || !run.tray[slot]) return;
    onGesture();
    setSelected(slot);
    const first = placements(run.board, run.tray[slot]!)[0];
    setPreview({ slot, row: first?.row ?? 0, col: first?.col ?? 0 });
    grid.current?.focus();
    setMessage("Arrow keys move the preview. Enter places it. Escape cancels.");
  };
  const previewPiece = preview ? run.tray[preview.slot] : null,
    valid =
      preview && previewPiece
        ? place(run.board, previewPiece, preview.row, preview.col)
        : null;
  const previewIds = new Set(
      preview && previewPiece
        ? SHAPE_BY_ID.get(previewPiece.shape)!
            .cells.map(([x, y]) => ({ r: preview.row + y, c: preview.col + x }))
            .filter((p) => p.r >= 0 && p.r < 8 && p.c >= 0 && p.c < 8)
            .map((p) => p.r * 8 + p.c)
        : [],
    ),
    clearIds = new Set(valid?.cleared ?? []);
  return (
    <div
      ref={root}
      className={"playfield " + (paused ? "concealed" : "")}
      style={
        {
          "--preview-color":
            selected !== null && run.tray[selected]
              ? `var(--block-${run.tray[selected]!.color})`
              : "var(--accent)",
        } as React.CSSProperties
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(e) => {
        contacts.current.delete(e.pointerId);
        multi.current = contacts.current.size > 0;
        reset();
      }}
    >
      <div
        ref={grid}
        role="grid"
        aria-label="8 by 8 block board"
        tabIndex={enabled ? 0 : -1}
        className="block-board"
        style={{ width: step * 8 + 2 * padding - gap }}
        onClick={(e) => {
          if (e.detail !== 0 || selected === null || !enabled) return;
          const cell = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-cell]",
          );
          if (!cell) return;
          const index = Number(cell.dataset.cell);
          confirm({
            slot: selected,
            row: Math.floor(index / 8),
            col: index % 8,
          });
        }}
        onKeyDown={(e) => {
          if (selected === null || !enabled) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            reset();
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (preview) confirm(preview);
            return;
          }
          if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            const p = preview ?? { slot: selected, row: 0, col: 0 },
              delta = (
                {
                  ArrowLeft: [0, -1],
                  ArrowRight: [0, 1],
                  ArrowUp: [-1, 0],
                  ArrowDown: [1, 0],
                } as Record<string, number[]>
              )[e.key];
            if (delta)
              setPreview({
                slot: selected,
                row: Math.max(0, Math.min(7, p.row + delta[0])),
                col: Math.max(0, Math.min(7, p.col + delta[1])),
              });
          }
        }}
      >
        {run.board.map((color, index) => (
          <BoardCell
            key={index}
            index={index}
            color={color}
            enabled={enabled}
            preview={
              previewIds.has(index) ? (valid ? "valid" : "invalid") : null
            }
            clearing={clearIds.has(index)}
          />
        ))}
        {flash ? (
          <div className="clear-layer" key={flash.id} aria-hidden="true">
            {flash.cells.map((c) => (
              <i
                key={c.index}
                className={"block clear-block color-" + c.color}
                style={{
                  left: padding + (c.index % 8) * step,
                  top: padding + Math.floor(c.index / 8) * step,
                  width: tile,
                  height: tile,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="piece-tray"
        role="group"
        aria-label="Available pieces"
        style={{ height: Math.max(64, 5 * trayTile + 20) }}
      >
        {run.tray.map((piece, slot) => (
          <button
            key={slot}
            data-slot={slot}
            className={
              "piece-slot " +
              (selected === slot ? "selected " : "") +
              (!piece ? "used" : "")
            }
            disabled={!piece || !enabled}
            aria-label={`Piece ${slot + 1}${piece ? ", " + SHAPE_BY_ID.get(piece.shape)!.count + " squares" : ", used"}`}
            aria-pressed={selected === slot}
            onClick={(e) => {
              if (e.detail === 0) keyboardSelect(slot);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                keyboardSelect(slot);
              }
            }}
          >
            {piece ? (
              <PieceView piece={piece} tile={trayTile} />
            ) : (
              <span className="used-dot" />
            )}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">
        {run.phase === "dealing" ? "Dealing your next three pieces…" : message}
      </p>
      {ghost && run.tray[ghost.slot] ? (
        <div
          ref={ghostElement}
          className={"drag-ghost " + (valid ? "" : "invalid")}
          style={{
            left: 0,
            top: 0,
            transform: `translate(${ghost.x}px, ${ghost.y}px)`,
          }}
        >
          <PieceView piece={run.tray[ghost.slot]!} tile={tile} />
        </div>
      ) : null}
    </div>
  );
});

const BoardCell = memo(function BoardCell({
  index,
  color,
  enabled,
  preview,
  clearing,
}: {
  index: number;
  color: number;
  enabled: boolean;
  preview: "valid" | "invalid" | null;
  clearing: boolean;
}) {
  return (
    <button
      role="gridcell"
      data-cell={index}
      tabIndex={-1}
      aria-label={`Row ${Math.floor(index / 8) + 1}, column ${(index % 8) + 1}${color ? ", occupied" : ", empty"}`}
      aria-disabled={!enabled || !!color}
      className={
        "board-cell " +
        (color ? "color-" + color : "") +
        (preview ? ` ${preview}-preview` : "") +
        (clearing ? " clear-preview" : "")
      }
    />
  );
});
