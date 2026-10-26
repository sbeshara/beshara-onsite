import { avatarTone, initials } from "@/lib/format";

export default function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <div className="av" style={{ background: `var(--av${avatarTone(id)})` }} title={name}>
      {initials(name)}
    </div>
  );
}
