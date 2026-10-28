import { avatarTone, initials } from "@/lib/format";

// Posts made on behalf of the company (e.g. progress reports).
export function CompanyAvatar() {
  return (
    <div className="av av-co" title="Beshara Builders" aria-hidden="true">
      <span className="av-logo" />
    </div>
  );
}

export default function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <div className="av" style={{ background: `var(--av${avatarTone(id)})` }} title={name}>
      {initials(name)}
    </div>
  );
}
