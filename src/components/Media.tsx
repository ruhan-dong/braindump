import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, Link } from "../api.ts";
import { formatSize } from "../format.ts";

const URL_SPLIT = /(https?:\/\/[^\s<>"'，。！？、）)\]]+)/gi;

/** Renders plain text with URLs turned into links. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const fileIcon = (mime: string) =>
  mime === "application/pdf" ? "📕" : mime.includes("sheet") || mime.includes("csv") ? "📊" : mime.includes("zip") ? "🗜️" : mime.startsWith("text/") ? "📄" : "📁";

export function FileChip({ a }: { a: Attachment }) {
  return (
    <a className="file-chip" href={a.url} target="_blank" rel="noreferrer" download={a.filename}>
      <span className="file-chip-icon">{fileIcon(a.mime)}</span>
      <span className="file-chip-name">{a.filename}</span>
      <span className="file-chip-size">{formatSize(a.size)}</span>
    </a>
  );
}

export function VoiceNote({ a }: { a: Attachment }) {
  return (
    <div className="voice">
      <audio src={a.url} controls preload="metadata" />
      {a.transcript && <p className="voice-transcript">“{a.transcript}”</p>}
    </div>
  );
}

/** One picture over the whole window. Closes on the × button, a click on the dark area, or Escape. */
function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={alt} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button className="viewer-close" onClick={onClose} aria-label="Close" autoFocus>
        ×
      </button>
      <img src={src} alt={alt} />
    </div>,
    document.body,
  );
}

/** A picture that opens in the viewer when clicked. With `href` (a link's preview image) it opens that page instead. */
export function ImageLink({ src, alt, href, className }: { src: string; alt: string; href?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        className={className}
        href={href ?? src}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (href) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} loading="lazy" />
      </a>
      {open && <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AttachmentView({ a }: { a: Attachment }) {
  if (a.kind === "image") return <ImageLink className="att-image" src={a.url} alt={a.filename} />;
  if (a.kind === "video") return <video className="att-video" src={a.url} controls preload="metadata" />;
  if (a.kind === "audio") return <VoiceNote a={a} />;
  return <FileChip a={a} />;
}

export function LinkCard({ link, compact = false }: { link: Link; compact?: boolean }) {
  const host = (() => {
    try {
      return new URL(link.url).hostname.replace(/^www\./, "");
    } catch {
      return link.url;
    }
  })();
  return (
    <a className={`link-card ${compact ? "compact" : ""}`} href={link.url} target="_blank" rel="noreferrer">
      {link.image && !compact && <img className="link-card-img" src={link.image} alt="" loading="lazy" />}
      <span className="link-card-text">
        <span className="link-card-site">
          {link.site_name ?? host}
        </span>
        <span className="link-card-title">{link.title ?? link.url}</span>
        {link.description && !compact && <span className="link-card-desc">{link.description}</span>}
      </span>
    </a>
  );
}
