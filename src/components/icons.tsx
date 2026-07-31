import type { SVGProps } from "react";

const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  chat: (
    <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v6M15 3v6" />
      <path d="M6 9h12v3a6 6 0 0 1-12 0V9ZM12 18v3" />
    </>
  ),
  spark: (
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  logout: <path d="M15 4h4v16h-4M11 8l-4 4 4 4M7 12h9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  arrowRight: <path d="M4 12h15m-6-6 6 6-6 6" />,
  bell: (
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7ZM10.5 20a2 2 0 0 0 3 0" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" />,
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" />,
  pause: <path d="M8 4.5v15M16 4.5v15" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6" />
    </>
  ),
  alert: <path d="M12 8v5M12 16.5v.5M12 3 2.5 20h19L12 3Z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M16 5.2a3.4 3.4 0 0 1 0 5.6M17.5 14.4A6.2 6.2 0 0 1 21.2 20" />
    </>
  ),
  chart: <path d="M4 20h16M7 20v-6M12 20V7M17 20v-9" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  send: <path d="M4 12 20.5 4l-6 16.5-3.2-6.8L4 12Z" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h3v3h-3zM20.5 14v3M17.5 20.5h3M14 20.5h.5" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11L10.5 22 19.5 10H13l0-8Z" />,
  shield: <path d="M12 3 5 6v5.5c0 4.5 3 7.8 7 9.5 4-1.7 7-5 7-9.5V6l-7-3Z" />,
  whatsapp: (
    <path d="M3.5 20.5 5 16.2A7.8 7.8 0 1 1 8.2 19.2L3.5 20.5Zm5.9-4.9c1.6 1.4 3.6 1.9 5 1.2.9-.5 1.3-1.4 1.1-2-.1-.3-1.9-1.3-2.2-1.2-.3.1-.6.8-.8.9-.2.1-.6 0-1.2-.5-.6-.5-1.1-1.1-1.2-1.4-.1-.3.1-.5.3-.7.2-.2.3-.4.4-.6.1-.2 0-.4-.1-.6-.1-.2-.7-1.7-1-2-.3-.2-.9-.1-1.3.3-.5.5-.9 1.4-.6 2.6.3 1.2 1 2.4 1.6 3Z" />
  ),
  pix: <path d="m12 2.5 4.6 4.6a3 3 0 0 0 2.1.9h.8L21.5 10a2.8 2.8 0 0 1 0 4l-2 2h-.8a3 3 0 0 0-2.1.9L12 21.5l-4.6-4.6a3 3 0 0 0-2.1-.9h-.8l-2-2a2.8 2.8 0 0 1 0-4l2-2h.8a3 3 0 0 0 2.1-.9L12 2.5Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V4.5A1.5 1.5 0 0 1 5.5 3h7A1.5 1.5 0 0 1 14 4.5V21M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21M2.5 21h19" />
      <path d="M7 7h3M7 11h3M7 15h3M17 14h0M17 17.5h0" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-5",
  ...rest
}: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Marca do produto. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="url(#af-g)" />
      <path
        d="M10 22.5 16 9l6 13.5M12.6 18.2h6.8"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <defs>
        <linearGradient id="af-g" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#9f75ff" />
          <stop offset="1" stopColor="#5a03d5" />
        </linearGradient>
      </defs>
    </svg>
  );
}
