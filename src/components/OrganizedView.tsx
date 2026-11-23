import { api, type Message } from "../api.ts";
import { CATEGORIES, type CategoryId } from "../../shared/categories.ts";
import { formatDay, formatTime, groupBy } from "../format.ts";
import { extraBody, headline, toEntries, visualOf, type Entry } from "../doc.ts";
import { AttachmentView, ImageLink, LinkCard } from "./Media.tsx";
import { ItemActions } from "./ItemActions.tsx";
import { ExampleNote } from "./JournalView.tsx";
import { COVERS } from "../covers.ts";
import { exampleProps, isExample, sampleMessages } from "../samples.ts";

/** Whether completed to-dos are listed, and the switch for it. Kept by the app so it is remembered and a jump can open it. */
export type DoneToggle = { showDone: boolean; onToggleDone: () => void };

/** The "Completed N" line that opens and closes a list of completed to-dos. */
export function CompletedToggle({ count, showDone, onToggleDone }: { count: number } & DoneToggle) {
  return (
    <button className="todo-done-toggle" onClick={onToggleDone}>
      {showDone ? "▾" : "▸"} Completed {count}
    </button>
  );
}

type Props = { messages: Message[]; onJumpToMessage: (id: string) => void } & DoneToggle;
type Jump = (id: string) => void;

/** Intent template: everything regrouped by what the user meant (to-do, link, inspiration…), then by topic. */
export function OrganizedView({ messages, onJumpToMessage, showDone, onToggleDone }: Props) {
  const own = messages.flatMap(toEntries);
  // With an empty log, the page is filled with faded examples instead of being left blank.
  const sample = messages.length === 0;
  // The earlier rule, kept to go back to: the examples stay until something is organized, so also while the first
  // message is still being organized.
  // const sample = own.length === 0;
  const shown = sample ? sampleMessages() : messages;
  const entries = sample ? shown.flatMap(toEntries) : own;
  // Only matters under the earlier rule: a message still being organized is in the Log with no entry here yet, and
  // the Log then has no examples to jump to.
  const faded = exampleProps(sample, messages.length === 0);
  const all = CATEGORIES.map((c) => ({ ...c, list: entries.filter((e) => e.category === c.id) }));
  const sections = all.filter((s) => s.list.length);
  // The user's own page lists every category at the top, with 0 on the ones that have nothing yet. The examples
  // keep to the categories they fill.
  const tags = sample ? sections : all;

  return (
    <div className="organized">
      {sample && <ExampleNote until="you send your first message in the Log" jumps={messages.length === 0} />}
      <figure className="cover">
        <img src={COVERS.fig} alt="" />
      </figure>
      <header className="org-head">
        <span className="page-icon" aria-hidden="true">🗂️</span>
        <h1>Everything, sorted</h1>
        <div {...faded}>
          <p className="org-props">
            {entries.length} {entries.length === 1 ? "item" : "items"} · from {shown.length} {shown.length === 1 ? "message" : "messages"}
          </p>
          <nav className="org-toc" aria-label="Categories">
            {tags.map((s) =>
              s.list.length ? (
                <a key={s.id} href={`#sec-${s.id}`} className={`tag cat-${s.id}`}>
                  {s.emoji} {s.label} <b>{s.id === "todo" ? s.list.filter((e) => !e.done).length : s.list.length}</b>
                </a>
              ) : (
                // Nothing to jump to, so not a link.
                <span key={s.id} className={`tag cat-${s.id}`}>
                  {s.emoji} {s.label} <b>0</b>
                </span>
              ),
            )}
          </nav>
        </div>
      </header>

      <div {...faded}>
        {sections.map((s) => (
          <section key={s.id} id={`sec-${s.id}`} className={`org-sec cat-${s.id}`}>
            <h2>
              <span className="org-sec-emoji">{s.emoji}</span>
              {s.label}
              <span className="org-sec-count">{s.list.length}</span>
            </h2>
            {s.id === "todo" ? <TodoSection list={s.list} onJump={onJumpToMessage} showDone={showDone} onToggleDone={onToggleDone} /> : <Topics id={s.id} list={newestFirst(s.list)} onJump={onJumpToMessage} />}
          </section>
        ))}
      </div>
    </div>
  );
}

const newestFirst = (list: Entry[]) => [...list].sort((a, b) => b.message.created_at - a.message.created_at);

/** Splits a category into topic groups when there's more than one; otherwise renders it flat. */
function Topics({ id, list, onJump }: { id: CategoryId; list: Entry[]; onJump: Jump }) {
  const groups = groupBy(list, (e) => e.topic ?? "").sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  if (groups.length < 2) return <CategoryBody id={id} list={list} onJump={onJump} />;
  return (
    <>
      {groups.map(([topic, items]) => (
        <div className="topic" key={topic}>
          <h3># {topic || "Other"}</h3>
          <CategoryBody id={id} list={items} onJump={onJump} />
        </div>
      ))}
    </>
  );
}

function CategoryBody({ id, list, onJump }: { id: CategoryId; list: Entry[]; onJump: Jump }) {
  if (id === "inspiration" || id === "moment") {
    const visual = list.filter((e) => visualOf(e) || e.attachment?.kind === "video");
    const rest = list.filter((e) => !visual.includes(e));
    return (
      <>
        {visual.length > 0 && (
          <div className="masonry">
            {visual.map((e) => (
              <Tile key={e.id} e={e} onJump={onJump} />
            ))}
          </div>
        )}
        {rest.length > 0 && <Cards list={rest} onJump={onJump} />}
      </>
    );
  }
  if (id === "link")
    return (
      <div className="link-grid">
        {list.map((e) => (
          <div className="org-item link-item" id={`item-${e.id}`} key={e.id}>
            {e.link ? <LinkCard link={{ ...e.link, title: e.title }} /> : <Card e={e} onJump={onJump} />}
            {extraBody(e) && <p className="link-note">{extraBody(e)}</p>}
            <Meta e={e} onJump={onJump} />
          </div>
        ))}
      </div>
    );
  return <Cards list={list} onJump={onJump} />;
}

function Cards({ list, onJump }: { list: Entry[]; onJump: Jump }) {
  return (
    <div className="card-grid">
      {list.map((e) => (
        <Card key={e.id} e={e} onJump={onJump} />
      ))}
    </div>
  );
}

function Card({ e, onJump }: { e: Entry; onJump: Jump }) {
  const body = extraBody(e);
  return (
    <div className="org-item card" id={`item-${e.id}`}>
      {e.attachment && <AttachmentView a={e.attachment} />}
      {e.link && <LinkCard link={e.link} compact />}
      <div className="card-title">{headline(e)}</div>
      {body && <p className="card-body">{body}</p>}
      <Meta e={e} onJump={onJump} />
    </div>
  );
}

function Tile({ e, onJump }: { e: Entry; onJump: Jump }) {
  const src = visualOf(e);
  const caption = e.attachment?.filename === e.title ? e.body : e.title;
  return (
    <figure className="org-item tile" id={`item-${e.id}`}>
      {src ? (
        <ImageLink src={src} alt={e.title} href={e.link?.url} />
      ) : (
        <video src={e.attachment!.url} controls preload="metadata" />
      )}
      {caption && <figcaption>{caption}</figcaption>}
      <Meta e={e} onJump={onJump} />
    </figure>
  );
}

function Meta({ e, onJump }: { e: Entry; onJump: Jump }) {
  const d = formatDay(e.message.created_at);
  return (
    <div className="meta">
      <span>
        {d.rel ? d.rel.replace(" · ", "") : d.date}, {formatTime(e.message.created_at)}
      </span>
      <ItemActions e={e} onJumpToMessage={onJump} />
    </div>
  );
}

function TodoSection({ list, onJump, showDone, onToggleDone }: { list: Entry[]; onJump: Jump } & DoneToggle) {
  const open = list.filter((e) => !e.done);
  const done = list.filter((e) => e.done);
  const groups = groupBy(open, (e) => e.topic ?? "").sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  const grouped = groups.length > 1;
  return (
    <>
      {open.length === 0 && <p className="todo-clear">All done 🎉</p>}
      {groups.map(([topic, items]) => (
        <div key={topic} className={grouped ? "topic" : undefined}>
          {grouped && <h3># {topic || "Other"}</h3>}
          <ul className="todo-list">
            {items.map((e) => (
              <TodoRow key={e.id} e={e} onJump={onJump} />
            ))}
          </ul>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <CompletedToggle count={done.length} showDone={showDone} onToggleDone={onToggleDone} />
          {showDone && (
            <ul className="todo-list done-list">
              {done.map((e) => (
                <TodoRow key={e.id} e={e} onJump={onJump} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function TodoRow({ e, onJump }: { e: Entry; onJump: Jump }) {
  const body = extraBody(e);
  return (
    <li className={`org-item todo ${e.done ? "done" : ""}`} id={`item-${e.id}`}>
      <input type="checkbox" checked={e.done} disabled={isExample(e.id)} onChange={() => api.patchItem(e.id, { done: !e.done })} />
      <div className="todo-main">
        <span className="todo-title">{headline(e)}</span>
        {body && <span className="todo-body">{body}</span>}
        {e.attachment && <AttachmentView a={e.attachment} />}
      </div>
      <Meta e={e} onJump={onJump} />
    </li>
  );
}
