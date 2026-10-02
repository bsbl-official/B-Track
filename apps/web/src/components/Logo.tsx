import { useId } from "react";

// A rectangle with its own radius per corner: [top-left, top-right, bottom-right, bottom-left].
function tile(x: number, y: number, width: number, height: number, [tl, tr, br, bl]: number[]) {
  return [
    `M${x + tl},${y}`,
    `H${x + width - tr}`,
    `Q${x + width},${y} ${x + width},${y + tr}`,
    `V${y + height - br}`,
    `Q${x + width},${y + height} ${x + width - br},${y + height}`,
    `H${x + bl}`,
    `Q${x},${y + height} ${x},${y + height - bl}`,
    `V${y + tl}`,
    `Q${x},${y} ${x + tl},${y}`,
    "Z",
  ].join(" ");
}

// The B-Track mark: four crimson tiles, inner corners rounded, with a soft sheen on the right pair.
const TILES = [
  tile(0, 0, 46, 22, [3, 8, 8, 3]),
  tile(51, 0, 46, 22, [8, 3, 3, 8]),
  tile(0, 28, 46, 22, [3, 8, 8, 3]),
  tile(51, 28, 46, 22, [8, 8, 8, 8]),
];

// Logo + "B-Track" wordmark. `stacked` puts the name under the logo (sign-in pages).
export function Brand({ size = 34, stacked = false }: { size?: number; stacked?: boolean }) {
  return (
    <span className={`brand-lockup ${stacked ? "stacked" : ""}`}>
      <Logo size={size} />
      <span className="brand-name"><span className="brand-b">B</span><span className="brand-dash">-</span>Track</span>
    </span>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="logo" width={size} height={Math.round((size * 50) / 97)} viewBox="0 0 97 50" role="img" aria-label="B-Track logo">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e3232b" />
          <stop offset="1" stopColor="#b8141b" />
        </linearGradient>
        <clipPath id={`${id}-right`}>
          <path d={TILES[1]} />
          <path d={TILES[3]} />
        </clipPath>
      </defs>
      {TILES.map((d) => <path key={d} d={d} fill={`url(#${id}-fill)`} />)}
      <g clipPath={`url(#${id}-right)`} fill="#fff" opacity="0.14">
        <ellipse cx="104" cy="30" rx="34" ry="26" />
      </g>
    </svg>
  );
}
