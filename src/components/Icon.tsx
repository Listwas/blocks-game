export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    fullscreen: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
    exitFullscreen: <path d="M4 9h5V4m6 0v5h5M9 20v-5H4m11 5v-5h5" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7" />,
    undo: (
      <path
        d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12"
        transform="translate(0 -2)"
      />
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    next: (
      <>
        <path d="m7 5 7 7-7 7M18 5v14" />
      </>
    ),
    previous: (
      <>
        <path d="m17 5-7 7 7 7M6 5v14" />
      </>
    ),
    plus: <path d="M5 12h14M12 5v14" />,
    minus: <path d="M5 12h14" />,
    cross: <path d="m6 6 12 12M18 6 6 18" />,
    fill: (
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
    ),
    play: <path d="m9 5 10 7-10 7Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    heart: (
      <path d="M20.8 4.6c-2-2.2-5.2-2-7.1.1L12 6.5l-1.7-1.8C8.4 2.6 5.2 2.4 3.2 4.6c-2 2.2-1.9 5.7.2 7.8L12 21l8.6-8.6c2.1-2.1 2.2-5.6.2-7.8Z" />
    ),
    shuffle: (
      <>
        <path d="M4 6h3l10 12h3M4 18h3L17 6h3m-3-3 3 3-3 3m0 6 3 3-3 3" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 1 1 4 3c-1 .4-1 1-1 2m0 3h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.help}
    </svg>
  );
}
export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={"brand " + (large ? "large" : "")} aria-hidden="true">
      {[1, 1, 0, 1, 0, 0, 1, 1, 1].map((v, i) => (
        <i key={i} className={v ? "ink" : ""} />
      ))}
    </div>
  );
}
