import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Message, type Template } from "./api.ts";
import { Chat } from "./components/Chat.tsx";
import { JournalView } from "./components/JournalView.tsx";
import { OrganizedView } from "./components/OrganizedView.tsx";
import { TemplateView } from "./components/TemplateView.tsx";
import { DeleteTemplateDialog, TemplateDialog } from "./components/TemplateDialog.tsx";
import { sampleMessages } from "./samples.ts";

/** "journal", "organized", or the id of a custom template. */
type View = string;

const savedView = (): View => {
  try {
    return localStorage.getItem("braindump.view") ?? "journal";
  } catch {
    return "journal";
  }
};

/** Whether the "Completed" list of to-dos is open, in Organized and in templates that set completed ones aside. Open unless the user collapsed it. */
const savedShowDone = (): boolean => {
  try {
    return localStorage.getItem("braindump.showDone") !== "0";
  } catch {
    return true;
  }
};

function upsert(list: Message[], m: Message) {
  const next = list.filter((x) => x.id !== m.id);
  next.push(m);
  return next.sort((a, b) => a.created_at - b.created_at);
}

/** Scrolls an element into view and briefly highlights it, once the page has been updated. */
function flash(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation if it's already flashing
    el.classList.add("flash");
  });
}

export default function App({ email }: { email: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  // Whether the log has been fetched. Until then nothing is drawn, so an empty log (which gets example messages)
  // can be told from one that hasn't arrived.
  const [loaded, setLoaded] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [view, setView] = useState<View>(savedView);
  const [showDone, setShowDone] = useState(savedShowDone);
  const [pane, setPane] = useState<"chat" | "doc">("chat"); // which pane is visible
  const [dialog, setDialog] = useState<{ editing?: Template } | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null); // the template whose × was clicked, until confirmed or kept
  const tabsRef = useRef<HTMLDivElement>(null);
  // Whether tabs are scrolled out of sight on each side. That side of the row fades out to show there is more.
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    api.status().then((s) => setAi(s.ai));
    api.templates.list().then(setTemplates);
    // (Re)load the full log on every (re)connect so nothing is missed while disconnected.
    return api.subscribe(
      (event) => {
        if (event.type === "message") setMessages((list) => upsert(list, event.message));
        if (event.type === "deleted") setMessages((list) => list.filter((m) => m.id !== event.id));
      },
      () =>
        api.list().then((list) => {
          setMessages(list);
          setLoaded(true);
        }),
    );
  }, []);

  // A remembered custom template may have been deleted since.
  const current = templates?.find((t) => t.id === view);
  const activeView = view === "journal" || view === "organized" || current || templates === null ? view : "journal";

  useEffect(() => {
    try {
      localStorage.setItem("braindump.view", activeView);
    } catch {
      // storage unavailable; the choice just won't persist
    }
  }, [activeView]);

  useEffect(() => {
    try {
      localStorage.setItem("braindump.showDone", showDone ? "1" : "0");
    } catch {
      // storage unavailable; the choice just won't persist
    }
  }, [showDone]);

  const jumpToItem = useCallback(
    (itemId: string) => {
      setPane("doc");
      // Always shown in Organized, which lists every item. A completed to-do is only on the page while "Completed" is open.
      setView("organized");
      // An empty log shows the example messages, and those can be jumped from too.
      const log = messages.length ? messages : sampleMessages();
      if (log.some((m) => m.items.some((i) => i.id === itemId && i.category === "todo" && i.done))) setShowDone(true);
      flash(`item-${itemId}`);
    },
    [messages],
  );

  const toggleDone = useCallback(() => setShowDone((s) => !s), []);

  const measureTabs = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    const row = new ResizeObserver(measureTabs);
    row.observe(tabsRef.current!);
    return () => row.disconnect();
  }, [measureTabs]);

  // The open tab is brought into sight: it can be off to one side when the page loads, or after a template is added.
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measureTabs();
  }, [activeView, templates, measureTabs]);

  const jumpToMessage = useCallback((messageId: string) => {
    setPane("chat");
    flash(`msg-${messageId}`);
  }, []);

  async function saveTemplate(prompt: string) {
    const editing = dialog?.editing;
    const t = editing ? await api.templates.update(editing.id, prompt) : await api.templates.create(prompt);
    setTemplates((list) => (editing ? (list ?? []).map((x) => (x.id === t.id ? t : x)) : [...(list ?? []), t]));
    setView(t.id);
    setDialog(null);
  }

  async function deleteTemplate(id: string) {
    await api.templates.remove(id);
    setTemplates((list) => (list ?? []).filter((t) => t.id !== id));
    // A tab's × deletes a template without opening it, so the open page only changes when it is the one deleted.
    setView((v) => (v === id ? "journal" : v));
  }

  // Shown at the top right of whichever pane is open.
  const account = api.demo ? null : (
    <button className="account" onClick={() => api.auth.signOut()} title={`Signed in as ${email}`}>
      Sign out
    </button>
  );

  // A template's tab gets an × to delete it, shown on hover. Not with an empty log, where templates can't be deleted yet.
  const tab = (id: View, label: string, template?: Template) => (
    <span key={id} className="tab-item" role="presentation">
      <button role="tab" aria-selected={activeView === id} className={activeView === id ? "on" : ""} onClick={() => setView(id)}>
        {label}
      </button>
      {template && messages.length > 0 && (
        <button className="tab-close" onClick={() => setDeleting(template)} title="Delete template" aria-label={`Delete ${template.spec.name}`}>
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </span>
  );

  return (
    <div className={`app pane-${pane}`}>
      <Chat messages={messages} loaded={loaded} onJumpToItem={jumpToItem} account={account} />

      <main className="doc">
        <div className="doc-bar">
          <div className="tab-bar">
            <div
              className={`tabs${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`}
              role="tablist"
              ref={tabsRef}
              onScroll={measureTabs}
              // A mouse wheel only turns up and down, so that moves the row sideways too.
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
              }}
            >
              {tab("journal", "📔 Journal")}
              {tab("organized", "🗂️ Organized")}
              {templates?.map((t) => tab(t.id, `${t.spec.emoji} ${t.spec.name}`, t))}
            </div>
            {/* Outside the row that scrolls, so it stays in sight however many tabs there are. */}
            <button className="tab-add" onClick={() => setDialog({})} title="Create Your Template" aria-label="Create Your Template">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              <span>Create Your Template</span>
            </button>
          </div>
          {account}
        </div>
        <div className="doc-scroll">
          {!loaded ? null : activeView === "journal" ? (
            <JournalView messages={messages} onJumpToMessage={jumpToMessage} />
          ) : activeView === "organized" ? (
            <OrganizedView messages={messages} onJumpToMessage={jumpToMessage} showDone={showDone} onToggleDone={toggleDone} />
          ) : current ? (
            <TemplateView
              key={current.id}
              template={current}
              messages={messages}
              onJumpToMessage={jumpToMessage}
              onEdit={() => setDialog({ editing: current })}
              onDelete={() => deleteTemplate(current.id)}
              showDone={showDone}
              onToggleDone={toggleDone}
            />
          ) : null}
        </div>
      </main>

      <nav className="pane-switch">
        <div className="pane-switch-inner">
          <button className={pane === "chat" ? "on" : ""} onClick={() => setPane("chat")}>
            💬 Log
          </button>
          <button className={pane === "doc" ? "on" : ""} onClick={() => setPane("doc")}>
            📄 Notebook
          </button>
        </div>
        {api.demo && <span className="ai-badge">Demo</span>}
        {/* How messages get sorted, kept small in the bottom-right corner so it stays out of the way. Hidden for now: put it back to bring it back.
        {!api.demo && ai !== null && (
          <span className={`ai-badge ${ai ? "on" : ""}`} title={ai ? "Sorted automatically by Claude" : "Set ANTHROPIC_API_KEY to turn on AI sorting"}>
            {ai ? "✦ Sorted by Claude" : "Rule-based sorting"}
          </span>
        )} */}
      </nav>

      {dialog && (
        <TemplateDialog
          editing={!!dialog.editing}
          initialPrompt={dialog.editing?.prompt}
          ai={!!ai}
          onSubmit={saveTemplate}
          onClose={() => setDialog(null)}
        />
      )}
      {deleting && <DeleteTemplateDialog name={deleting.spec.name} onDelete={() => deleteTemplate(deleting.id).then(() => setDeleting(null))} onClose={() => setDeleting(null)} />}
    </div>
  );
}
