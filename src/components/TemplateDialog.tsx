import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "A weekly review of my ideas and notes, in a serif magazine style",
  "A reading list of everything I saved, as a compact list",
  "A moodboard gallery of my inspiration images",
  "Open to-dos grouped by topic, as a green checklist",
  "A timeline of my day, oldest first, in a typewriter font",
];

type Props = {
  initialPrompt?: string;
  editing: boolean;
  ai: boolean;
  onSubmit: (prompt: string) => Promise<void>;
  onClose: () => void;
};

/** Prompt box for creating a template, or changing the prompt of an existing one. */
export function TemplateDialog({ initialPrompt = "", editing, ai, onSubmit, onClose }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(prompt.trim());
    } catch (e) {
      console.error(e);
      setError("Couldn't make the template. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="tpl-dialog-title">
        <h2 id="tpl-dialog-title">{editing ? "Edit template" : "New template"}</h2>
        <p className="dialog-lede">Describe the page you want. What should it show, how should it be grouped, and how should it look?</p>
        <textarea
          id="tpl-prompt"
          ref={textRef}
          rows={3}
          value={prompt}
          placeholder="e.g. A weekly review of my ideas and notes, in a serif magazine style"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          disabled={busy}
        />
        {!editing && (
          <div className="dialog-examples" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setPrompt(ex)} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {/* Hidden for now: put it back to bring it back.
        {ai && <p className="dialog-mode">Claude turns your description into a template.</p>} */}
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={busy || !prompt.trim()}>
            {busy ? "Making template…" : editing ? "Update template" : "Create template"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asks before a template is deleted from its tab, since it can't be brought back. */
export function DeleteTemplateDialog({ name, onDelete, onClose }: { name: string; onDelete: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      console.error(e);
      setError("Couldn't delete the template. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      {/* Kept quiet: small text only, and two plain buttons. */}
      <div className="dialog dialog-confirm" role="dialog" aria-modal="true" aria-labelledby="tpl-delete-text">
        <p className="dialog-lede" id="tpl-delete-text">
          “{name}” will be deleted.
          <br />
          Everything in your Log stays.
        </p>
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
