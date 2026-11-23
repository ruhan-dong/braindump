import { useState, type ReactNode } from "react";
import { api, type Message, type Template } from "../api.ts";
import { CATEGORIES, categoryOf } from "../../shared/categories.ts";
import type { TemplateSpec } from "../../shared/templates.ts";
import { dayKey, formatDay, formatTime, groupBy } from "../format.ts";
import { extraBody, headline, toEntries, visualOf, type Entry } from "../doc.ts";
import { AttachmentView, ImageLink, LinkCard } from "./Media.tsx";
import { ItemActions } from "./ItemActions.tsx";
import { ExampleNote } from "./JournalView.tsx";
import { COVERS } from "../covers.ts";
import { exampleProps, isExample, sampleMessages } from "../samples.ts";
import { CompletedToggle, type DoneToggle } from "./OrganizedView.tsx";

type Props = {
  template: Template;
  messages: Message[];
  onJumpToMessage: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
} & DoneToggle;
type Jump = (id: string) => void;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Monday of the week a timestamp falls in, at local midnight. */
function weekStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Splits entries into labeled sections. */
function group(by: TemplateSpec["groupBy"], list: Entry[]): { key: string; label: string; entries: Entry[] }[] {
  const at = (e: Entry) => e.message.created_at;
  switch (by) {
    case "none":
      return [{ key: "all", label: "", entries: list }];
    case "day":
      return groupBy(list, (e) => dayKey(at(e))).map(([key, entries]) => {
        const d = formatDay(at(entries[0]));
        return { key, label: `${d.rel}${d.weekday}, ${d.date}`, entries };
      });
    case "week":
      return groupBy(list, (e) => String(weekStart(at(e)).getTime())).map(([key, entries]) => {
        const start = new Date(Number(key));
        return { key, label: `Week of ${MONTHS[start.getMonth()]} ${start.getDate()}`, entries };
      });
    case "month":
      return groupBy(list, (e) => {
        const d = new Date(at(e));
        return `${d.getFullYear()}-${d.getMonth()}`;
      }).map(([key, entries]) => {
        const d = new Date(at(entries[0]));
        return { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, entries };
      });
    case "category":
      return CATEGORIES.map((c) => ({ key: c.id, label: `${c.emoji} ${c.label}`, entries: list.filter((e) => e.category === c.id) })).filter(
        (g) => g.entries.length,
      );
    case "topic":
      return groupBy(list, (e) => e.topic ?? "")
        .sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : y.length - x.length))
        .map(([key, entries]) => ({ key: key || "other", label: key || "Other", entries }));
  }
}

export function TemplateView({ template, messages, onJumpToMessage, onEdit, onDelete, showDone, onToggleDone }: Props) {
  const { spec } = template;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fits = (e: Entry) => spec.include.length === 0 || spec.include.includes(e.category as never);
  const own = messages.flatMap(toEntries).filter(fits);
  // With an empty log, the page is filled with the faded examples that fit it instead of being left blank.
  const examples = messages.length ? [] : sampleMessages().flatMap(toEntries).filter(fits);
  // The earlier rule, kept to go back to: a template keeps its examples until something of the person's own fits it,
  // which can be after the Log has lost its own. Going back also means the earlier `until` on the ExampleNote below.
  // const examples = own.length ? [] : sampleMessages().flatMap(toEntries).filter(fits);
  const sample = examples.length > 0;
  const all = (sample ? examples : own).sort((a, b) => (spec.sort === "newest" ? -1 : 1) * (a.message.created_at - b.message.created_at));
  // A template that leaves out completed to-dos lists them at the end instead, under "Completed", the way Organized does.
  const done = spec.hideDone ? all.filter((e) => e.done) : [];
  const entries = spec.hideDone ? all.filter((e) => !e.done) : all;
  // Topics are only added when Claude organizes the entries. With none, a topic template groups by category instead,
  // or stays one plain list when everything is in the same category.
  const noTopics = spec.groupBy === "topic" && !entries.some((e) => e.topic);
  const oneCategory = new Set(entries.map((e) => e.category)).size <= 1;
  const by = noTopics ? (oneCategory ? "none" : "category") : spec.groupBy;
  const groups = group(by, entries);
  const showCategory = spec.include.length !== 1 && by !== "category";

  return (
    <div className={`tpl font-${spec.style.font} accent-${spec.style.accent} density-${spec.style.density}`}>
      {/* Under the earlier rule: until="something in your Log fits this template" */}
      {sample && <ExampleNote until="you send your first message in the Log" jumps={messages.length === 0} />}
      <header className="tpl-head">
        <span className="page-icon tpl-icon" aria-hidden="true">
          {spec.emoji}
        </span>
        <h1>{spec.title}</h1>
        {spec.subtitle && <p className="tpl-subtitle">{spec.subtitle}</p>}
        <div className="tpl-source">
          <span className="tpl-prompt" title="The prompt this template was made from">
            “{template.prompt}”
          </span>
          <button onClick={onEdit}>Edit prompt</button>
          {confirmDelete ? (
            <>
              <button className="danger" onClick={onDelete}>
                Delete template
              </button>
              <button onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </div>
        {spec.note && <p className="tpl-note">{spec.note}</p>}
      </header>

      {/* Nothing in the log fits, or with an empty log no example does, such as a page of moments only. */}
      {all.length === 0 && (
        <div className="empty">
          <img src={COVERS.moon} alt="" />
          <p>Nothing matches this template yet</p>
        </div>
      )}
      <div {...exampleProps(sample, messages.length === 0)}>
        {entries.length > 0 &&
          groups.map((g) => (
            <section className="tpl-group" key={g.key}>
              {g.label && (
                <h2>
                  {g.label}
                  <span className="tpl-count">{g.entries.length}</span>
                </h2>
              )}
              <Layout spec={spec} list={g.entries} showCategory={showCategory} onJump={onJumpToMessage} />
            </section>
          ))}
        {done.length > 0 && (
          <section className="tpl-group">
            {entries.length === 0 && <p className="todo-clear">All done 🎉</p>}
            <CompletedToggle count={done.length} showDone={showDone} onToggleDone={onToggleDone} />
            {showDone && (
              <div className="done-list">
                <Layout spec={spec} list={done} showCategory={showCategory} onJump={onJumpToMessage} />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- Layouts ----------

function Layout({ spec, list, showCategory, onJump }: { spec: TemplateSpec; list: Entry[]; showCategory: boolean; onJump: Jump }) {
  const meta = (e: Entry) => <Meta e={e} spec={spec} showCategory={showCategory} onJump={onJump} />;
  switch (spec.layout) {
    case "list":
      return (
        <ul className="tpl-list">
          {list.map((e) => (
            <li key={e.id} id={`item-${e.id}`} className="org-item tpl-row">
              <Check e={e} />
              {visualOf(e) && <img className="tpl-thumb" src={visualOf(e)} alt="" loading="lazy" />}
              <div className="tpl-row-main">
                <Title e={e} />
                {extraBody(e) && <p className="tpl-body">{extraBody(e)}</p>}
                {e.attachment && !visualOf(e) && <AttachmentView a={e.attachment} />}
              </div>
              {meta(e)}
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return (
        <ul className="tpl-checklist">
          {list.map((e) => (
            <li key={e.id} id={`item-${e.id}`} className={`org-item tpl-check ${e.done ? "done" : ""}`}>
              {e.category === "todo" ? <Check e={e} /> : <span className="tpl-bullet" aria-hidden="true" />}
              <div className="tpl-row-main">
                <Title e={e} />
                {extraBody(e) && <p className="tpl-body">{extraBody(e)}</p>}
              </div>
              {meta(e)}
            </li>
          ))}
        </ul>
      );
    case "timeline":
      return (
        <ol className="tpl-timeline">
          {list.map((e) => (
            <li key={e.id} id={`item-${e.id}`} className="org-item">
              <time className="tpl-when">{formatTime(e.message.created_at)}</time>
              <div className="tpl-row-main">
                <Media e={e} />
                <div className="tpl-title-row">
                  <Check e={e} />
                  <Title e={e} />
                </div>
                {extraBody(e) && <p className="tpl-body">{extraBody(e)}</p>}
                <Meta e={e} spec={{ ...spec, showTime: false }} showCategory={showCategory} onJump={onJump} />
              </div>
            </li>
          ))}
        </ol>
      );
    case "gallery":
      return (
        <div className="tpl-gallery">
          {list.map((e) => (
            <figure key={e.id} id={`item-${e.id}`} className={`org-item tpl-tile ${visualOf(e) ? "" : "text-tile"}`}>
              {visualOf(e) ? (
                <ImageLink src={visualOf(e)!} alt={e.title} href={e.link?.url} />
              ) : (
                e.attachment && <AttachmentView a={e.attachment} />
              )}
              <figcaption>
                <div className="tpl-title-row">
                  <Check e={e} />
                  <Title e={e} />
                </div>
                {!visualOf(e) && extraBody(e) && <p className="tpl-body">{extraBody(e)}</p>}
                {meta(e)}
              </figcaption>
            </figure>
          ))}
        </div>
      );
    case "cards":
      return (
        <div className="tpl-cards">
          {list.map((e) => (
            <article key={e.id} id={`item-${e.id}`} className="org-item tpl-card">
              <Media e={e} />
              <div className="tpl-title-row">
                <Check e={e} />
                <Title e={e} />
              </div>
              {extraBody(e) && <p className="tpl-body">{extraBody(e)}</p>}
              {meta(e)}
            </article>
          ))}
        </div>
      );
  }
}

// ---------- Pieces ----------

function Check({ e }: { e: Entry }) {
  if (e.category !== "todo") return null;
  return (
    <input
      type="checkbox"
      className="tpl-checkbox"
      checked={e.done}
      disabled={isExample(e.id)}
      aria-label={e.done ? "Mark as not done" : "Mark as done"}
      onChange={() => api.patchItem(e.id, { done: !e.done })}
    />
  );
}

function Title({ e }: { e: Entry }) {
  const text = headline(e);
  const cls = `tpl-title ${e.done ? "is-done" : ""}`;
  return e.link ? (
    <a className={cls} href={e.link.url} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className={cls}>{text}</span>
  );
}

function Media({ e }: { e: Entry }): ReactNode {
  if (e.link && !visualOf(e)) return <LinkCard link={e.link} compact />;
  if (e.link) return <LinkCard link={{ ...e.link, title: e.link.title ?? e.title }} />;
  if (e.attachment) return <AttachmentView a={e.attachment} />;
  return null;
}

function Meta({ e, spec, showCategory, onJump }: { e: Entry; spec: TemplateSpec; showCategory: boolean; onJump: Jump }) {
  const c = categoryOf(e.category);
  const d = formatDay(e.message.created_at);
  // The date is redundant when the section heading already says which day it is.
  const when = spec.groupBy === "day" ? formatTime(e.message.created_at) : `${d.rel ? d.rel.replace(" · ", "") : d.date}, ${formatTime(e.message.created_at)}`;
  return (
    <div className="meta tpl-meta">
      <span className="tpl-meta-info">
        {showCategory && (
          <span className={`tag cat-${c.id}`}>
            {c.emoji} {c.label}
          </span>
        )}
        {spec.showTime && <span>{when}</span>}
      </span>
      <ItemActions e={e} onJumpToMessage={onJump} />
    </div>
  );
}
