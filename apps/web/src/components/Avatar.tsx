import { initials } from "../format";

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (url) return <img className="avatar" src={url} alt="" style={style} referrerPolicy="no-referrer" />;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
