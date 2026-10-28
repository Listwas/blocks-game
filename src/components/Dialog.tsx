import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  onBack,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    el.showModal();
    el.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus();
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => {
      el.removeEventListener("cancel", cancel);
      el.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>("[data-dialog-close]")
      ?.focus();
  }, [title]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href],[tabindex]",
          ),
        ].filter(
          (e) =>
            !e.hasAttribute("disabled") &&
            e.tabIndex >= 0 &&
            e.getClientRects().length,
        );
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)!.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0].focus();
        }
      }}
      className={"dialog " + (wide ? "wide" : "")}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        {onBack ? (
          <button
            className="icon"
            aria-label="Back to settings"
            onClick={onBack}
          >
            <Icon name="back" />
          </button>
        ) : null}
        <h2 id={titleId}>{title}</h2>
        <button
          data-dialog-close
          className="icon"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
