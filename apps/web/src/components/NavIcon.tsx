// Line icons for the sidebar (they stay recognisable when the sidebar is collapsed).
const paths: Record<string, string[]> = {
  dashboard: ["M3.5 3.5h7v7h-7z", "M13.5 3.5h7v4h-7z", "M13.5 10.5h7v10h-7z", "M3.5 13.5h7v7h-7z"],
  tasks: ["M4 5.5h16", "M4 12h16", "M4 18.5h16", "M8.5 3v18"],
  pos: ["M4 20.5V6.5l8-3 8 3v14", "M2.5 20.5h19", "M9 20.5v-5h6v5", "M8 9.5h.01", "M12 9.5h.01", "M16 9.5h.01"],
  access: ["M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z", "m9 12 2 2 4-4"],
  collapse: ["M15 6l-6 6 6 6"],
  logout: ["M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14", "M10 16l-4-4 4-4", "M6 12h10"],
};

export function NavIcon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {(paths[name] ?? []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
