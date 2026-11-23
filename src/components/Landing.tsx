import { useRef, useState } from "react";
import log from "../assets/landing/log.png";
import organized from "../assets/landing/organized.png";
import template from "../assets/landing/template.png";

const FEATURES = [
  {
    title: "Intuitive chat history as a log",
    body: "Write the way you text. Thoughts, links, photos and voice notes land in one timestamped log.",
    shot: log,
    alt: "The BrainDump log: messages, an image and a link, each with a category tag and a time",
  },
  {
    title: "Auto-categorized notes",
    body: "Every note is automatically sorted into a category and laid out neatly, in the built-in pages and the templates you make. Click its label to move it somewhere else.",
    shot: organized,
    alt: "The Organized page: everything sorted into to-dos, ideas, saved items and more",
  },
  {
    title: "Create your customized template",
    body: "Describe a page in plain words, like a reading list or a moodboard, and it gets built from your log.",
    shot: template,
    alt: "The New template dialog, where a page is described in plain words",
    still: true, // the dialog is all that matters here, so hovering doesn't pan down
  },
];

/** The page signed-out visitors see first. */
export function Landing({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const [active, setActive] = useState(0);
  const screen = useRef<HTMLDivElement>(null);

  function pick(i: number) {
    if (i === active) return;
    // Start the picked screenshot from the top again. It is still hidden here, so the jump isn't seen.
    for (const a of screen.current?.children[i]?.getAnimations() ?? []) if (a instanceof CSSAnimation) a.currentTime = 0;
    setActive(i);
  }

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="brand-mark">🧠</span>
          <span>BrainDump</span>
        </div>
        <button className="btn" onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <section className="landing-hero">
        <h1>
          Dump anything.
          <br />
          <em>It gets sorted for you.</em>
        </h1>
        <p>A notes app that feels like texting yourself. BrainDump keeps the log and does the organizing.</p>
        <button className="btn primary" onClick={onSignUp}>
          Get started
        </button>
      </section>

      <section className="showcase">
        <div className="showcase-tabs" role="tablist" aria-orientation="vertical" aria-label="Features">
          {FEATURES.map((f, i) => (
            <button
              key={f.title}
              id={`feature-${i}`}
              role="tab"
              aria-selected={active === i}
              aria-controls="showcase-screen"
              className={active === i ? "on" : ""}
              onClick={() => pick(i)}
            >
              <span className="showcase-num">0{i + 1}</span>
              <span className="showcase-title">{f.title}</span>
              <span className="showcase-body">
                <span>{f.body}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="monitor">
          <div className="monitor-frame">
            <div className="monitor-screen" ref={screen} id="showcase-screen" role="tabpanel" aria-labelledby={`feature-${active}`}>
              {FEATURES.map((f, i) => (
                <img key={f.title} src={f.shot} alt={active === i ? f.alt : ""} className={[active === i && "on", f.still && "still"].filter(Boolean).join(" ")} aria-hidden={active !== i} />
              ))}
            </div>
          </div>
          <div className="monitor-neck" />
          <div className="monitor-foot" />
        </div>
      </section>

      <footer className="landing-foot">
        <span>🧠 BrainDump</span>
        <span>Your notes are private to your account.</span>
      </footer>
    </div>
  );
}
