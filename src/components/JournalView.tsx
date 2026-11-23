import type { CSSProperties, ReactNode } from "react";
import { api, type Message } from "../api.ts";
import { CATEGORIES } from "../../shared/categories.ts";
import { dayKey, formatDay, formatTime, groupBy } from "../format.ts";
import { extraBody, hash, headline, toEntries, visualOf, type Entry } from "../doc.ts";
import { exampleProps, isExample, sampleMessages } from "../samples.ts";
import { FileChip, ImageLink, Linkified, VoiceNote } from "./Media.tsx";
import { ItemActions } from "./ItemActions.tsx";

type Props = { messages: Message[]; onJumpToMessage: (id: string) => void };
type Jump = (id: string) => void;

/** Free-form template: one magazine spread per day, content grouped into sections rather than a timeline. */
export function JournalView({ messages, onJumpToMessage }: Props) {
  // With an empty log, the page is filled with faded examples instead of being left blank.
  const sample = messages.length === 0;
  const days = groupBy(sample ? sampleMessages() : messages, (m) => dayKey(m.created_at)).reverse();
  return (
    <div className="journal">
      {sample && <ExampleNote until="you send your first message in the Log" />}
      <div {...exampleProps(sample)}>
        {days.map(([key, msgs]) => (
          <DayPage key={key} day={key} msgs={msgs} onJump={onJumpToMessage} />
        ))}
      </div>
    </div>
  );
}

// ---------- Page composition ----------

type Module = { key: string; wide: boolean; count: number; label: string; node: ReactNode };

function DayPage({ day, msgs, onJump }: { day: string; msgs: Message[]; onJump: Jump }) {
  const d = formatDay(msgs[0].created_at);
  const entries = msgs.flatMap(toEntries);
  const pending = msgs.filter((m) => m.status === "pending" && m.items.length === 0);

  // Sort every entry into the section it belongs to on the page.
  const taken = new Set<string>();
  const take = (pred: (e: Entry) => boolean) => {
    const out = entries.filter((e) => !taken.has(e.id) && pred(e));
    out.forEach((e) => taken.add(e.id));
    return out;
  };
  const inspo = take((e) => !!visualOf(e) && e.category === "inspiration");
  const photos = take((e) => (!!visualOf(e) && e.category !== "link") || e.attachment?.kind === "video");
  const todos = take((e) => e.category === "todo");
  const ideas = take((e) => e.category === "idea" && e.attachment?.kind !== "file");
  const links = take((e) => !!e.link);
  const voices = take((e) => e.attachment?.kind === "audio");
  const files = take((e) => !!e.attachment);
  const notes = take(() => true);

  const modules: Module[] = [];
  if (notes.length) modules.push({ key: "notes", wide: true, count: notes.length, label: "Notes", node: <Notes list={notes} onJump={onJump} /> });
  if (todos.length) modules.push({ key: "todos", wide: false, count: todos.length, label: "To do", node: <Todos list={todos} onJump={onJump} /> });
  if (photos.length) modules.push({ key: "photos", wide: photos.length > 1, count: photos.length, label: "Moments", node: <Photos list={photos} onJump={onJump} /> });
  if (ideas.length) modules.push({ key: "ideas", wide: false, count: ideas.length, label: "Ideas", node: <Ideas list={ideas} onJump={onJump} /> });
  if (inspo.length) modules.push({ key: "inspo", wide: inspo.length > 1, count: inspo.length, label: "Inspiration", node: <Moodboard list={inspo} onJump={onJump} /> });
  if (links.length) modules.push({ key: "links", wide: links.length > 2, count: links.length, label: "Further reading", node: <Reading list={links} onJump={onJump} /> });
  if (voices.length) modules.push({ key: "voices", wide: false, count: voices.length, label: "Voice memos", node: <Voices list={voices} onJump={onJump} /> });
  if (files.length) modules.push({ key: "files", wide: false, count: files.length, label: "Files", node: <Files list={files} onJump={onJump} /> });
  if (pending.length) modules.push({ key: "pending", wide: false, count: pending.length, label: "Organizing…", node: <Pending msgs={pending} /> });

  const counts = CATEGORIES.map((c) => ({ c, n: entries.filter((e) => e.category === c.id).length })).filter((x) => x.n);

  return (
    <article className="issue">
      <header className="issue-head">
        <div className="kicker">
          {d.rel}
          {d.weekday}
        </div>
        <h2 className="issue-title">{d.date}</h2>
        <p className="issue-dek">{counts.map(({ c, n }) => `${n} ${c.unit[n === 1 ? 0 : 1]}`).join(" · ") || "Organizing…"}</p>
      </header>
      <div className="spread">{arrange(modules, day)}</div>
    </article>
  );
}

/**
 * Pairs wide and narrow sections into rows on a 12-column grid, alternating which side the wide
 * one sits on so each day reads like a laid-out spread instead of a stack.
 */
function arrange(modules: Module[], seed: string): ReactNode[] {
  const wides = modules.filter((m) => m.wide);
  const narrows = modules.filter((m) => !m.wide);
  const placed: { m: Module; col: string }[] = [];
  let row = hash(seed) % 2;
  while (wides.length || narrows.length) {
    const flip = row++ % 2 === 1;
    const w = wides.shift();
    const n = narrows.shift();
    if (w && n) {
      placed.push(flip ? { m: n, col: "1 / span 5" } : { m: w, col: "1 / span 7" });
      placed.push(flip ? { m: w, col: "6 / span 7" } : { m: n, col: "8 / span 5" });
    } else if (w) {
      placed.push({ m: w, col: "1 / -1" });
    } else if (n) {
      const n2 = narrows.shift();
      placed.push({ m: n, col: n2 ? "1 / span 6" : "1 / span 7" });
      if (n2) placed.push({ m: n2, col: "7 / span 6" });
    }
  }
  return placed.map(({ m, col }) => (
    <section key={m.key} className={`mod mod-${m.key}`} style={{ "--col": col } as CSSProperties}>
      <div className="mod-head">
        <span className="kicker">{m.count === 1 ? "1 entry" : `${m.count} entries`}</span>
        <h3>{m.label}</h3>
      </div>
      {m.node}
    </section>
  ));
}

// ---------- Sections ----------

const Hover = ({ e, onJump }: { e: Entry; onJump: Jump }) => <ItemActions e={e} onJumpToMessage={onJump} />;
const time = (e: Entry) => <time className="tiny-time">{formatTime(e.message.created_at)}</time>;

function Notes({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="notes">
      {list.map((e) => (
        <div key={e.id} id={`item-${e.id}`} className="j-item note">
          <p>
            <Linkified text={e.body || e.title} />
          </p>
          {time(e)}
          <Hover e={e} onJump={onJump} />
        </div>
      ))}
    </div>
  );
}

function Todos({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <ul className="checklist">
      {list.map((e) => (
        <li key={e.id} id={`item-${e.id}`} className={`j-item j-todo ${e.done ? "done" : ""}`}>
          <label>
            <input type="checkbox" checked={e.done} disabled={isExample(e.id)} onChange={() => api.patchItem(e.id, { done: !e.done })} />
            <span className="j-todo-text">
              {e.attachment?.kind === "audio" && "🎙️ "}
              {headline(e)}
            </span>
          </label>
          <Hover e={e} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

function Photos({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className={`photos n${Math.min(list.length, 3)}`}>
      {list.map((e) => {
        const caption = e.body || (e.attachment?.filename === e.title ? "" : e.title);
        const src = visualOf(e);
        return (
          <figure key={e.id} id={`item-${e.id}`} className="j-item photo">
            {src ? (
              <ImageLink src={src} alt={e.title} href={e.link?.url} />
            ) : (
              <video src={e.attachment!.url} controls preload="metadata" />
            )}
            <figcaption>
              <span>{caption}</span>
              {time(e)}
            </figcaption>
            <Hover e={e} onJump={onJump} />
          </figure>
        );
      })}
    </div>
  );
}

function Moodboard({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="moodboard">
      {list.map((e) => (
        <figure key={e.id} id={`item-${e.id}`} className="j-item mood">
          <ImageLink src={visualOf(e)!} alt={e.title} href={e.link?.url} />
          {(e.body || e.title) && <figcaption>{e.body || e.title}</figcaption>}
          <Hover e={e} onJump={onJump} />
        </figure>
      ))}
    </div>
  );
}

function Ideas({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="ideas">
      {list.map((e) => {
        const body = extraBody(e);
        return (
          <blockquote key={e.id} id={`item-${e.id}`} className="j-item pull">
            <p className="pull-text">{headline(e)}</p>
            {body && <p className="pull-body">{body}</p>}
            {e.attachment?.kind === "audio" && <VoiceNote a={e.attachment} />}
            {time(e)}
            <Hover e={e} onJump={onJump} />
          </blockquote>
        );
      })}
    </div>
  );
}

function Reading({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <ul className="reading">
      {list.map((e) => {
        const body = extraBody(e);
        return (
          <li key={e.id} id={`item-${e.id}`} className="j-item">
            <a href={e.link!.url} target="_blank" rel="noreferrer">
              <span className="reading-text">
                <span className="reading-site">{e.link!.site_name}</span>
                <span className="reading-title">{e.title}</span>
                {body && <span className="reading-note">{body}</span>}
              </span>
              {e.link!.image && <img src={e.link!.image} alt="" loading="lazy" />}
            </a>
            <Hover e={e} onJump={onJump} />
          </li>
        );
      })}
    </ul>
  );
}

function Voices({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="voices">
      {list.map((e) => (
        <div key={e.id} id={`item-${e.id}`} className="j-item voice-card">
          <div className="voice-card-head">
            {/* A truncated title just repeats the transcript shown below. */}
            <span>{e.title.endsWith("…") ? "Voice memo" : e.title}</span>
            {time(e)}
          </div>
          <VoiceNote a={e.attachment!} />
          <Hover e={e} onJump={onJump} />
        </div>
      ))}
    </div>
  );
}

function Files({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="files">
      {list.map((e) => (
        <div key={e.id} id={`item-${e.id}`} className="j-item">
          <FileChip a={e.attachment!} />
          {extraBody(e) && <p className="file-note">{extraBody(e)}</p>}
          <Hover e={e} onJump={onJump} />
        </div>
      ))}
    </div>
  );
}

function Pending({ msgs }: { msgs: Message[] }) {
  return (
    <div className="notes">
      {msgs.map((m) => (
        <p key={m.id} className="j-pending">
          <Linkified text={m.text || "…"} />
        </p>
      ))}
    </div>
  );
}

/**
 * The banner on a Notebook page that is showing example entries (src/samples.ts) because the person has nothing of
 * their own for it yet. It goes first on the page and stays at the top as the page scrolls, like the one above the
 * box to type in in the Log. `jumps` is false where the arrow to an entry's message isn't offered (see exampleProps).
 */
export function ExampleNote({ until, jumps = true }: { until: string; jumps?: boolean }) {
  return (
    <p className="example-note">
      These are example entries.{jumps && " Click ↗ on one to see its message in the Log."} They go away once {until}.
    </p>
  );
}
