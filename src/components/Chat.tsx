import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, type Item, type Message, type Photo, type Recall } from "../api.ts";
import { CATEGORIES } from "../../shared/categories.ts";
import { dayKey, formatDay, formatTime, groupBy } from "../format.ts";
import { AttachmentView, LinkCard, Linkified } from "./Media.tsx";
import { Composer } from "./Composer.tsx";
import { PhotoAccessDialog, usePhotoLibrary } from "./PhotoAccess.tsx";
import { COVERS } from "../covers.ts";

type Props = {
  messages: Message[];
  onJumpToItem: (itemId: string) => void;
  /** The sign-out control, shown at the right of the header. */
  account?: ReactNode;
};

export function Chat({ messages, onJumpToItem, account }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const library = usePhotoLibrary();
  const [photosOpen, setPhotosOpen] = useState(false);
  const openPhotos = () => setPhotosOpen(true);

  // Keep the view pinned to the newest message unless the user scrolled up to read history.
  const pinToBottom = () => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(pinToBottom, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => (stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      className={`chat ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        setDropped([...e.dataTransfer.files]);
      }}
    >
      <header className="chat-header">
        <div className="brand">
          <span className="brand-mark">🧠</span>
          <span>BrainDump</span>
        </div>
        <div className="chat-header-end">
          <span className="chat-count">{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
          {account}
        </div>
      </header>

      <div
        className="chat-list"
        ref={listRef}
        // Images and videos load after the first scroll; keep the newest message in view as they grow the list.
        onLoadCapture={pinToBottom}
        onLoadedMetadataCapture={pinToBottom}
      >
        {messages.length === 0 && (
          <div className="empty">
            <img src={COVERS.toast} alt="" />
            <h2>Empty your head here</h2>
            <p>To-dos, ideas, links, screenshots, inspiration, voice memos. Send them as they come and Docs sorts them for you.</p>
          </div>
        )}
        {groupBy(messages, (m) => dayKey(m.created_at)).map(([day, msgs]) => {
          const d = formatDay(msgs[0].created_at);
          return (
            <div key={day}>
              <div className="day-sep">
                <span>
                  {d.rel}
                  {d.weekday}, {d.date}
                </span>
              </div>
              {msgs.map((m) => (
                <Bubble key={m.id} m={m} onJumpToItem={onJumpToItem} onOpenPhotos={openPhotos} />
              ))}
            </div>
          );
        })}
      </div>

      <Composer
        dropped={dropped}
        onDroppedConsumed={() => setDropped([])}
        // Photo library is hidden for now: without onOpenPhotos the paperclip opens the file picker straight away. Put it back to bring it back.
        // onOpenPhotos={api.demo ? undefined : openPhotos}
        scan={library.scan}
      />
      {dragging && <div className="drop-overlay">Drop to add</div>}
      {photosOpen && <PhotoAccessDialog library={library} onClose={() => setPhotosOpen(false)} />}
    </section>
  );
}

type BubbleProps = { m: Message; onJumpToItem: (itemId: string) => void; onOpenPhotos: () => void };

function Bubble({ m, onJumpToItem, onOpenPhotos }: BubbleProps) {
  // Links without a fetched preview yet are still shown inline in the text.
  return (
    <div className="msg" id={`msg-${m.id}`}>
      <div className="msg-body">
        {m.attachments.length > 0 && (
          <div className={`msg-atts n${Math.min(m.attachments.length, 3)}`}>
            {m.attachments.map((a) => (
              <AttachmentView key={a.id} a={a} />
            ))}
          </div>
        )}
        {m.text && (
          <div className="bubble">
            <Linkified text={m.text} />
          </div>
        )}
        {m.links.map((l) => (
          <LinkCard key={l.id} link={l} compact />
        ))}
      </div>
      {m.recall && (
        <RecallCard recall={m.recall} todo={m.items.find((i) => i.category === "todo")} onOpenPhotos={onOpenPhotos} onJumpToItem={onJumpToItem} />
      )}
      <div className="msg-meta">
        {/* A tagged message has these actions in its tag menus; the rest (sorting, failed, photo searches) get ···. */}
        {!api.demo && !(m.status === "done" && m.items.length) && <MessageMenu m={m} />}
        <Status m={m} onJumpToItem={onJumpToItem} />
        <time dateTime={new Date(m.created_at).toISOString()}>{formatTime(m.created_at)}</time>
      </div>
    </div>
  );
}

type RecallCardProps = { recall: Recall; todo?: Item; onOpenPhotos: () => void; onJumpToItem: (itemId: string) => void };

/** BrainDump's answer to "find that screenshot…": the matching photos and what's in them, and any to-do made from them. */
function RecallCard({ recall, todo, onOpenPhotos, onJumpToItem }: RecallCardProps) {
  const { terms, photos, searched } = recall;
  const quoted = terms.map((t) => `“${t}”`).join(", ");
  let note: ReactNode = null;
  if (searched === 0)
    note = (
      <>
        BrainDump can't see any photos yet.{" "}
        <button className="link-btn" onClick={onOpenPhotos}>
          Give photo access
        </button>
      </>
    );
  else if (!terms.length) note = "Tell me a word or two that's in the photo, like “leg day” or “hackathon”.";
  else if (!photos.length) note = `No photo matched ${quoted}. Searched ${searched} ${searched === 1 ? "photo" : "photos"}.`;

  return (
    <div className="recall">
      <div className="recall-head">🔎 {note ?? `Found ${photos.length} ${photos.length === 1 ? "photo" : "photos"} for ${quoted}`}</div>
      {todo && (
        <button className="recall-todo" onClick={() => onJumpToItem(todo.id)} title="Show in Docs">
          ✅ Added to your to-dos: <strong>{todo.title}</strong>
          {todo.body && <small>{todo.body}</small>}
        </button>
      )}
      {photos.length > 0 && (
        <div className="recall-grid">
          {photos.map((p) => (
            <RecallPhoto key={p.id} photo={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecallPhoto({ photo }: { photo: Photo }) {
  const [saved, setSaved] = useState<"no" | "saving" | "yes">("no");
  const when = photo.taken_at ? new Date(photo.taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <figure className="recall-photo">
      <a href={photo.url} target="_blank" rel="noreferrer">
        <img src={photo.url} alt={photo.path} loading="lazy" />
      </a>
      <figcaption>
        <span className="recall-path" title={`${photo.folder}/${photo.path}`}>
          {photo.path.split("/").pop()}
          {when && ` · ${when}`}
        </span>
        {photo.text ? (
          <details>
            <summary>What's in it</summary>
            <p>{photo.text}</p>
          </details>
        ) : (
          <span className="recall-notext">No text found in this photo</span>
        )}
        <button
          className="link-btn"
          disabled={saved !== "no"}
          onClick={async () => {
            setSaved("saving");
            try {
              await api.photos.save(photo.id);
              setSaved("yes");
            } catch {
              setSaved("no");
            }
          }}
        >
          {saved === "yes" ? "✓ Saved to notes" : saved === "saving" ? "Saving…" : "Save to my notes"}
        </button>
      </figcaption>
    </figure>
  );
}

function Status({ m, onJumpToItem }: { m: Message; onJumpToItem: (itemId: string) => void }) {
  if (m.status === "pending") return <span className="status pending">Sorting…</span>;
  if (m.status === "error")
    return (
      <button className="status error" onClick={() => api.reorganize(m.id)}>
        Couldn't sort · Retry
      </button>
    );
  return (
    <span className="status-chips">
      {CATEGORIES.map((c) => {
        const items = m.items.filter((i) => i.category === c.id);
        if (!items.length) return null;
        return <CategoryChip key={c.id} m={m} category={c} items={items} onJumpToItem={onJumpToItem} />;
      })}
    </span>
  );
}

/** Menus open downward, so one under the last message can run past the log; scroll it into view. */
const revealMenu = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" });

/** A menu that stays open until a choice is made, a click lands outside it, or Escape is pressed. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// Actions on the whole message. They need the server (and confirm() doesn't work inside a shared Artifact),
// so callers leave them out of the demo.
type ActionProps = { m: Message; close: () => void };

function SortAgainButton({ m, close }: ActionProps) {
  return (
    <button
      onClick={() => {
        close();
        api.reorganize(m.id);
      }}
    >
      Try auto sort again
    </button>
  );
}

function DeleteMessageButton({ m, close }: ActionProps) {
  return (
    <button
      className="danger"
      onClick={() => {
        close();
        if (confirm("Delete this whole message?")) api.remove(m.id);
      }}
    >
      Delete message
    </button>
  );
}

type ChipProps = { m: Message; category: (typeof CATEGORIES)[number]; items: Item[]; onJumpToItem: (itemId: string) => void };

/** A category tag that opens a menu: move its items to another category, show them in Docs, or act on the message. */
function CategoryChip({ m, category, items, onJumpToItem }: ChipProps) {
  const { open, setOpen, ref } = useMenu();

  function move(to: string) {
    setOpen(false);
    if (to !== category.id) for (const i of items) api.patchItem(i.id, { category: to });
  }

  return (
    <span className="tag-menu" ref={ref}>
      <button className={`tag cat-${category.id}`} onClick={() => setOpen((o) => !o)} title="Change category" aria-expanded={open}>
        {category.emoji} {category.label}
        {items.length > 1 ? ` ×${items.length}` : ""}
        <svg className="tag-caret" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <span className="msg-menu-pop" ref={revealMenu}>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={c.id === category.id ? "on" : ""} onClick={() => move(c.id)}>
              {c.emoji} {c.label}
            </button>
          ))}
          {!api.demo && <SortAgainButton m={m} close={() => setOpen(false)} />}
          <hr />
          <button
            onClick={() => {
              setOpen(false);
              onJumpToItem(items[0].id);
            }}
          >
            Show in Docs
          </button>
          {!api.demo && (
            <>
              <hr />
              <DeleteMessageButton m={m} close={() => setOpen(false)} />
            </>
          )}
        </span>
      )}
    </span>
  );
}

function MessageMenu({ m }: { m: Message }) {
  const { open, setOpen, ref } = useMenu();
  return (
    <span className={open ? "msg-menu open" : "msg-menu"} ref={ref}>
      <button className="msg-menu-btn" onClick={() => setOpen((o) => !o)} aria-label="More" aria-expanded={open}>
        ···
      </button>
      {open && (
        <span className="msg-menu-pop" ref={revealMenu}>
          <SortAgainButton m={m} close={() => setOpen(false)} />
          <DeleteMessageButton m={m} close={() => setOpen(false)} />
        </span>
      )}
    </span>
  );
}
