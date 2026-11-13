import type { Message } from "../server/db.ts";
import { auth } from "./auth.ts";

export type { Message, Item, Attachment, Link, Photo, Recall } from "../server/db.ts";
export type { Template, TemplateSpec } from "../shared/templates.ts";
import type { Template } from "../shared/templates.ts";
export type Pending = { file: File; transcript?: string; preview?: string };
/** What the browser read from one photo in a granted folder. */
export type PhotoMeta = {
  folder: string;
  path: string;
  size: number;
  modified_at: number;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  text: string;
};
export type ServerEvent = { type: "message"; message: Message } | { type: "deleted"; id: string };

async function ok(res: Response) {
  // The server no longer accepts this browser's session (expired, or signed out elsewhere): go back to the sign-in page.
  if (res.status === 401) await auth.forget();
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}
const getJson = (url: string) => fetch(url).then(ok).then((r) => r.json());

export const api = {
  /** The static demo build (src/demo/api.ts) swaps this module out and sets this to true. */
  demo: false,
  auth,
  /** Live updates. onOpen fires on every (re)connect so the caller can reload anything it missed. */
  subscribe: (onEvent: (e: ServerEvent) => void, onOpen: () => void) => {
    const es = new EventSource("/api/events");
    es.onopen = onOpen;
    es.onmessage = (ev) => onEvent(JSON.parse(ev.data));
    return () => es.close();
  },
  status: (): Promise<{ ai: boolean }> => getJson("/api/status"),
  list: (): Promise<Message[]> => getJson("/api/messages"),
  send: async (text: string, files: Pending[]): Promise<Message> => {
    const form = new FormData();
    form.append("text", text);
    for (const p of files) form.append("files", p.file);
    form.append("transcripts", JSON.stringify(files.map((p) => p.transcript ?? null)));
    return (await ok(await fetch("/api/messages", { method: "POST", body: form }))).json();
  },
  remove: (id: string) => fetch(`/api/messages/${id}`, { method: "DELETE" }).then(ok),
  reorganize: (id: string) => fetch(`/api/messages/${id}/reorganize`, { method: "POST" }).then(ok),
  templates: {
    list: (): Promise<Template[]> => getJson("/api/templates"),
    create: async (prompt: string): Promise<Template> =>
      (await ok(await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }))).json(),
    update: async (id: string, prompt: string): Promise<Template> =>
      (await ok(await fetch(`/api/templates/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }))).json(),
    remove: (id: string) => fetch(`/api/templates/${id}`, { method: "DELETE" }).then(ok),
  },
  patchItem: (id: string, patch: { done?: boolean; category?: string }) =>
    fetch(`/api/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(ok),
  photos: {
    folders: (): Promise<{ folders: { folder: string; count: number }[] }> => getJson("/api/photos"),
    known: (folder: string): Promise<string[]> => getJson(`/api/photos/known?folder=${encodeURIComponent(folder)}`),
    add: async (meta: PhotoMeta, thumb: Blob) => {
      const form = new FormData();
      form.append("meta", JSON.stringify(meta));
      form.append("thumb", thumb, "thumb.jpg");
      await ok(await fetch("/api/photos", { method: "POST", body: form }));
    },
    removeFolder: (folder: string) => fetch(`/api/photos?folder=${encodeURIComponent(folder)}`, { method: "DELETE" }).then(ok),
    save: (id: string) => fetch(`/api/photos/${id}/save`, { method: "POST" }).then(ok),
  },
};
