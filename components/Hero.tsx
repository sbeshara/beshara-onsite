import { greeting } from "@/lib/format";
import { ChatIcon, DocIcon, GridIcon } from "./Icons";

type Props = { name: string; eyebrow: string; copy: string; children?: React.ReactNode };

// The photo banner. children replaces the default feature chips.
export default function Hero({ name, eyebrow, copy, children }: Props) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="hero-eyebrow">{eyebrow}</div>
        <h1>
          {greeting()}, <em>{name}</em>
        </h1>
        <p>{copy}</p>
        <div className="feats">
          {children ?? (
            <>
              <span className="feat"><ChatIcon />Chats by topic</span>
              <span className="feat"><DocIcon />Shared plans &amp; documents</span>
              <span className="feat"><GridIcon />Live project progress</span>
            </>
          )}
        </div>
      </div>
      <div className="hero-photo" aria-hidden="true" />
    </section>
  );
}
