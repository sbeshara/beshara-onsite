import { greeting } from "@/lib/format";
import { ChatIcon, DocIcon, GridIcon } from "./Icons";

export default function Hero({ name, eyebrow, copy }: { name: string; eyebrow: string; copy: string }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="hero-eyebrow">{eyebrow}</div>
        <h1>
          {greeting()}, <em>{name}</em>
        </h1>
        <p>{copy}</p>
        <div className="feats">
          <span className="feat"><ChatIcon />Chats by topic</span>
          <span className="feat"><DocIcon />Shared plans &amp; documents</span>
          <span className="feat"><GridIcon />Live project progress</span>
        </div>
      </div>
      <div className="hero-photo" aria-hidden="true" />
    </section>
  );
}
