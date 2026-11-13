import postgres from "postgres";
import crypto from "node:crypto";
import type { Template, TemplateSpec } from "../shared/templates.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase values.");

// The tables are created by `npm run db:migrate` from supabase/migrations/. Every row belongs to one user, and every
// function below takes that user's id first and only ever touches their rows.
export const sql = postgres(process.env.DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  onnotice: false,
  // bigint columns hold millisecond timestamps and file sizes, which fit in a JavaScript number.
  types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(Math.round(x)), parse: (x: string) => Number(x) } },
});

export const newId = () => crypto.randomUUID();

export type Attachment = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  filename: string;
  mime: string;
  size: number;
  url: string;
  transcript: string | null;
};
export type Link = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
};
export type Item = {
  id: string;
  category: string;
  topic: string | null;
  title: string;
  body: string;
  attachment_id: string | null;
  link_id: string | null;
  done: boolean;
};
export type Photo = {
  id: string;
  folder: string;
  path: string;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  text: string;
  url: string; // thumbnail
};
export type Recall = { terms: string[]; photos: Photo[]; searched: number };
export type Message = {
  id: string;
  created_at: number;
  text: string;
  status: "pending" | "done" | "error";
  attachments: Attachment[];
  links: Link[];
  items: Item[];
  recall?: Recall; // set when the message asked to find a photo
};

type Row = Record<string, any>;

/** Turns message rows into full messages. Fetches everything attached to them in one round of queries, not per message. */
async function hydrate(userId: string, rows: Row[]): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((m) => m.id);
  const [attachments, links, items, recalls] = await Promise.all([
    sql`SELECT * FROM attachments WHERE user_id = ${userId} AND message_id = ANY(${ids}) ORDER BY position`,
    sql`SELECT * FROM links WHERE user_id = ${userId} AND message_id = ANY(${ids}) ORDER BY position`,
    sql`SELECT * FROM items WHERE user_id = ${userId} AND message_id = ANY(${ids}) ORDER BY position`,
    sql`SELECT * FROM recalls WHERE user_id = ${userId} AND message_id = ANY(${ids})`,
  ]);
  const photoIds = [...new Set(recalls.flatMap((r) => r.photo_ids as string[]))];
  const photos = new Map(
    photoIds.length === 0
      ? []
      : (await sql`SELECT * FROM photos WHERE user_id = ${userId} AND id = ANY(${photoIds})`).map((p) => [p.id as string, toPhoto(p)]),
  );

  return rows.map((m) => {
    const message: Message = {
      id: m.id,
      created_at: m.created_at,
      text: m.text,
      status: m.status,
      attachments: attachments
        .filter((a) => a.message_id === m.id)
        .map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, mime: a.mime, size: a.size, url: `/uploads/${a.stored_name}`, transcript: a.transcript })),
      links: links
        .filter((l) => l.message_id === m.id)
        .map((l) => ({ id: l.id, url: l.url, title: l.title, description: l.description, image: l.image, site_name: l.site_name })),
      items: items
        .filter((i) => i.message_id === m.id)
        .map((i) => ({ id: i.id, category: i.category, topic: i.topic, title: i.title, body: i.body, attachment_id: i.attachment_id, link_id: i.link_id, done: i.done })),
    };
    const recall = recalls.find((r) => r.message_id === m.id);
    if (recall) {
      // Photos can be removed from the library after the search; show the ones that are left.
      const found = (recall.photo_ids as string[]).map((id) => photos.get(id)).filter((p): p is Photo => p !== undefined);
      message.recall = { terms: recall.terms, photos: found, searched: recall.searched };
    }
    return message;
  });
}

export async function listMessages(userId: string, conversationId = "main"): Promise<Message[]> {
  return hydrate(userId, await sql`SELECT * FROM messages WHERE user_id = ${userId} AND conversation_id = ${conversationId} ORDER BY created_at`);
}

export async function getMessage(userId: string, id: string): Promise<Message | null> {
  const [message] = await hydrate(userId, await sql`SELECT * FROM messages WHERE user_id = ${userId} AND id = ${id}`);
  return message ?? null;
}

export async function getStoredName(userId: string, attachmentId: string): Promise<string> {
  const [row] = await sql`SELECT stored_name FROM attachments WHERE user_id = ${userId} AND id = ${attachmentId}`;
  return row.stored_name;
}

export async function insertMessage(
  userId: string,
  text: string,
  attachments: { kind: Attachment["kind"]; filename: string; mime: string; size: number; storedName: string; transcript: string | null }[],
): Promise<Message> {
  const id = newId();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO messages (id, user_id, created_at, text) VALUES (${id}, ${userId}, ${Date.now()}, ${text})`;
    const rows = attachments.map((a, position) => ({
      id: newId(),
      user_id: userId,
      message_id: id,
      position,
      kind: a.kind,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      stored_name: a.storedName,
      transcript: a.transcript,
    }));
    if (rows.length) await tx`INSERT INTO attachments ${tx(rows)}`;
  });
  return (await getMessage(userId, id))!;
}

export async function replaceLinks(userId: string, messageId: string, links: Omit<Link, "id">[]) {
  const rows = links.map((l, position) => ({ id: newId(), user_id: userId, message_id: messageId, position, ...l }));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM links WHERE user_id = ${userId} AND message_id = ${messageId}`;
    if (rows.length) await tx`INSERT INTO links ${tx(rows, "id", "user_id", "message_id", "position", "url", "title", "description", "image", "site_name")}`;
  });
}

export async function replaceItems(userId: string, messageId: string, items: Omit<Item, "id" | "done">[]) {
  const rows = items.map((i, position) => ({ id: newId(), user_id: userId, message_id: messageId, position, ...i }));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM items WHERE user_id = ${userId} AND message_id = ${messageId}`;
    if (rows.length) {
      await tx`INSERT INTO items ${tx(rows, "id", "user_id", "message_id", "position", "category", "topic", "title", "body", "attachment_id", "link_id")}`;
    }
  });
}

export async function setStatus(userId: string, messageId: string, status: Message["status"]) {
  await sql`UPDATE messages SET status = ${status} WHERE user_id = ${userId} AND id = ${messageId}`;
}

/** Returns the id of the message the item belongs to, or null if the user has no such item. */
export async function updateItem(userId: string, id: string, patch: { done?: boolean; category?: string }): Promise<string | null> {
  const [row] = await sql`
    UPDATE items SET done = COALESCE(${patch.done ?? null}, done), category = COALESCE(${patch.category ?? null}, category)
    WHERE user_id = ${userId} AND id = ${id} RETURNING message_id`;
  return row?.message_id ?? null;
}

/** Deletes a message and everything derived from it. Returns its uploaded files so they can be deleted too. */
export async function deleteMessage(userId: string, id: string): Promise<string[]> {
  const files = await sql`SELECT stored_name FROM attachments WHERE user_id = ${userId} AND message_id = ${id}`;
  await sql`DELETE FROM messages WHERE user_id = ${userId} AND id = ${id}`;
  return files.map((r) => r.stored_name);
}

/** Messages of any user that were mid-organize when the server last stopped. */
export async function pendingMessages(): Promise<{ id: string; user_id: string }[]> {
  return sql<{ id: string; user_id: string }[]>`SELECT id, user_id FROM messages WHERE status = 'pending'`;
}

/** Topics already in use per category, so new items reuse them instead of inventing near-duplicates. */
export async function existingTopics(userId: string): Promise<Record<string, string[]>> {
  const rows = await sql`
    SELECT category, topic, COUNT(*)::int AS n FROM items WHERE user_id = ${userId} AND topic IS NOT NULL
    GROUP BY category, topic ORDER BY n DESC`;
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.category] ??= []).push(r.topic);
  return out;
}

// ---------- Photo library ----------

const toPhoto = (r: Row): Photo => ({
  id: r.id,
  folder: r.folder,
  path: r.path,
  taken_at: r.taken_at,
  lat: r.lat,
  lon: r.lon,
  text: r.text,
  url: `/thumbs/${r.thumb_name}`,
});

export async function getPhoto(userId: string, id: string): Promise<Photo | null> {
  const [row] = await sql`SELECT * FROM photos WHERE user_id = ${userId} AND id = ${id}`;
  return row ? toPhoto(row) : null;
}

export async function listPhotos(userId: string): Promise<Photo[]> {
  return (await sql`SELECT * FROM photos WHERE user_id = ${userId}`).map(toPhoto);
}

export async function photoFolders(userId: string): Promise<{ folder: string; count: number }[]> {
  return sql<{ folder: string; count: number }[]>`
    SELECT folder, COUNT(*)::int AS count FROM photos WHERE user_id = ${userId} GROUP BY folder ORDER BY folder`;
}

/** "path|size|modified" for every photo already indexed in a folder, so a rescan only reads new or changed files. */
export async function knownPhotoKeys(userId: string, folder: string): Promise<string[]> {
  const rows = await sql`SELECT path, size, modified_at FROM photos WHERE user_id = ${userId} AND folder = ${folder}`;
  return rows.map((r) => `${r.path}|${r.size}|${r.modified_at}`);
}

/** Adds a photo, or replaces it if the file changed. Returns the thumbnail it replaced, if any, so it can be deleted. */
export async function upsertPhoto(
  userId: string,
  p: Omit<Photo, "id" | "url"> & { size: number; modified_at: number; thumb_name: string },
): Promise<string | null> {
  const [old] = await sql`SELECT thumb_name FROM photos WHERE user_id = ${userId} AND folder = ${p.folder} AND path = ${p.path}`;
  await sql`
    INSERT INTO photos (id, user_id, folder, path, size, modified_at, taken_at, lat, lon, text, thumb_name, indexed_at)
    VALUES (${newId()}, ${userId}, ${p.folder}, ${p.path}, ${p.size}, ${p.modified_at}, ${p.taken_at}, ${p.lat}, ${p.lon}, ${p.text}, ${p.thumb_name}, ${Date.now()})
    ON CONFLICT (user_id, folder, path) DO UPDATE SET size = excluded.size, modified_at = excluded.modified_at, taken_at = excluded.taken_at,
      lat = excluded.lat, lon = excluded.lon, text = excluded.text, thumb_name = excluded.thumb_name, indexed_at = excluded.indexed_at`;
  return old?.thumb_name ?? null;
}

/** Forgets a folder. Returns its thumbnails so they can be deleted. */
export async function deletePhotoFolder(userId: string, folder: string): Promise<string[]> {
  const rows = await sql`DELETE FROM photos WHERE user_id = ${userId} AND folder = ${folder} RETURNING thumb_name`;
  return rows.map((r) => r.thumb_name);
}

export async function saveRecall(userId: string, messageId: string, terms: string[], photoIds: string[], searched: number) {
  await sql`
    INSERT INTO recalls (message_id, user_id, terms, photo_ids, searched) VALUES (${messageId}, ${userId}, ${terms}, ${photoIds}, ${searched})
    ON CONFLICT (message_id) DO UPDATE SET terms = excluded.terms, photo_ids = excluded.photo_ids, searched = excluded.searched`;
}

// ---------- Templates ----------

const toTemplate = (r: Row): Template => ({ id: r.id, created_at: r.created_at, prompt: r.prompt, spec: r.spec });

export async function listTemplates(userId: string): Promise<Template[]> {
  return (await sql`SELECT * FROM templates WHERE user_id = ${userId} ORDER BY created_at`).map(toTemplate);
}

export async function insertTemplate(userId: string, prompt: string, spec: TemplateSpec): Promise<Template> {
  const [row] = await sql`
    INSERT INTO templates (id, user_id, created_at, prompt, spec) VALUES (${newId()}, ${userId}, ${Date.now()}, ${prompt}, ${sql.json(spec)}) RETURNING *`;
  return toTemplate(row);
}

export async function updateTemplate(userId: string, id: string, prompt: string, spec: TemplateSpec): Promise<Template | null> {
  const [row] = await sql`UPDATE templates SET prompt = ${prompt}, spec = ${sql.json(spec)} WHERE user_id = ${userId} AND id = ${id} RETURNING *`;
  return row ? toTemplate(row) : null;
}

export async function deleteTemplate(userId: string, id: string) {
  await sql`DELETE FROM templates WHERE user_id = ${userId} AND id = ${id}`;
}
