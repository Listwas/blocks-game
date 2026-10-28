import { useState } from "react";

function PracticeBoard({ line }: { line: boolean }) {
  const [selected, setSelected] = useState(false),
    [placed, setPlaced] = useState(false);
  const size = line ? 5 : 4,
    gaps = line ? [13, 14] : [5, 6],
    occupied = line ? [0, 5, 10, 11, 12, 19, 24] : [0, 3, 12];
  const place = (index: number) => {
    if (selected && !placed && gaps.includes(index)) setPlaced(true);
  };
  return (
    <>
      <div
        className={
          "practice-board " +
          (line ? "line-board " : "") +
          (placed ? "settled" : "")
        }
        role="group"
        aria-label={line ? "Line clearing practice board" : "Practice board"}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {Array.from({ length: size * size }, (_, i) => {
          const cleared = line && placed && Math.floor(i / size) === 2,
            filled =
              !cleared &&
              (occupied.includes(i) || (placed && gaps.includes(i)));
          return (
            <button
              key={i}
              data-practice-square={i}
              aria-label={`Practice square ${i + 1}${filled ? ", occupied" : ""}`}
              className={
                (gaps.includes(i) && !placed ? "gap " : "") +
                (filled ? "filled " : "") +
                (cleared ? "line-cleared" : "")
              }
              onClick={() => place(i)}
            />
          );
        })}
      </div>
      <div className="practice-tray">
        <button
          className={
            "practice-piece " +
            (selected ? "selected " : "") +
            (placed ? "placed" : "")
          }
          aria-label="Select practice piece"
          aria-pressed={selected}
          disabled={placed}
          onClick={() => setSelected(true)}
        >
          <i />
          <i />
        </button>
      </div>
      <p className="lesson-tip" aria-live="polite">
        {placed
          ? line
            ? "Line cleared! The full row is empty again. The other blocks stay."
            : "Piece placed! Pieces fit only on empty squares."
          : selected
            ? "Tap either outlined square to place the piece."
            : "Tap the piece below the board first."}
      </p>
    </>
  );
}

export function Tutorial({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  return (
    <div className="tutorial">
      <span className="eyebrow">{step + 1} / 3</span>
      <h3>{["Place a piece", "Fill a line", "Keep making space"][step]}</h3>
      {step < 2 ? (
        <>
          <p>
            {step === 0
              ? "Tap the two-square piece below, then tap an outlined square."
              : "This row needs two more blocks. Place the piece in the outlined gaps to clear the whole row. Full columns clear too."}
          </p>
          <PracticeBoard key={step} line={step === 1} />
        </>
      ) : (
        <>
          <div className="lesson-three" aria-hidden="true">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <b>→</b>
            <span>3 new</span>
          </div>
          <p>Use all three pieces to get another set. Pieces cannot rotate.</p>
          <p>
            If nothing fits, the run ends - unless you have an undo to try
            again.
          </p>
          <p className="lesson-tip">
            Earn an undo every 5,000 new points. Store one at a time.
          </p>
        </>
      )}
      <div className="tutorial-actions">
        {step > 0 && (
          <button className="secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button
          className="primary"
          onClick={() => (step < 2 ? setStep(step + 1) : onFinish())}
        >
          {step < 2 ? "Next" : "Play"}
        </button>
      </div>
    </div>
  );
}
