import { avatarTone, initials } from "@/lib/format";

// Posts made on behalf of the company (e.g. progress reports).
export function CompanyAvatar() {
  return (
    <div className="av av-co" title="Beshara Builders" aria-hidden="true">
      <span className="av-logo" />
    </div>
  );
}

export default function Avatar({ id, name, url }: { id: string; name: string; url?: string | null }) {
  if (url)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="av av-img" src={url} alt="" title={name} loading="lazy" />
    );
  return (
    <div className="av" style={{ background: `var(--av${avatarTone(id)})` }} title={name}>
      {initials(name)}
    </div>
  );
}
