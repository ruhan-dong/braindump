// Sample data that ships with the repo in seed/: a log, its images and voice memos, and a few custom templates.
//   npm run seed:import <email>   copy it into that user's account, if the account is still empty
// The demo build (vite.demo.config.ts) shows the same sample.
import "./env.ts";
import fs from "node:fs";
import path from "node:path";
import type { Message } from "./db.ts";
import type { Template } from "../shared/templates.ts";

const SEED_DIR = path.resolve("seed");
const SEED_FILE = path.join(SEED_DIR, "seed.json");
export const SEED_UPLOADS = path.join(SEED_DIR, "uploads");

type Row = Record<string, any>;
// Rows as they were exported from the original SQLite database, children in the order they were added.
type Seed = { messages: Row[]; attachments: Row[]; links: Row[]; items: Row[]; templates: Row[] };
const readSeed = (): Seed => JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));

/** The sample log in the shape the API returns. Attachment files are in SEED_UPLOADS, named by the end of their url. */
export function seedMessages(): Message[] {
  const seed = readSeed();
  return seed.messages.map((m) => ({
    id: m.id,
    created_at: m.created_at,
    text: m.text,
    status: m.status,
    attachments: seed.attachments
      .filter((a) => a.message_id === m.id)
      .map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, mime: a.mime, size: a.size, url: `/uploads/${a.stored_name}`, transcript: a.transcript })),
    links: seed.links
      .filter((l) => l.message_id === m.id)
      .map((l) => ({ id: l.id, url: l.url, title: l.title, description: l.description, image: l.image, site_name: l.site_name })),
    items: seed.items
      .filter((i) => i.message_id === m.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ id: i.id, category: i.category, topic: i.topic, title: i.title, body: i.body, attachment_id: i.attachment_id, link_id: i.link_id, done: !!i.done })),
  }));
}

export function seedTemplates(): Template[] {
  return readSeed().templates.map((t) => ({ id: t.id, created_at: t.created_at, prompt: t.prompt, spec: JSON.parse(t.spec) }));
}

/** Copies the sample into one user's account. Does nothing if they already have data, so it never touches real notes. */
async function importSeed(email: string) {
  const { sql, newId } = await import("./db.ts");
  const { putFile } = await import("./storage.ts");
  try {
    const [user] = await sql`SELECT id FROM auth.users WHERE email = ${email}`;
    if (!user) throw new Error(`No user with the email ${email}. Add them in the Supabase dashboard first.`);
    const [{ n }] = await sql`
      SELECT (SELECT COUNT(*) FROM messages WHERE user_id = ${user.id})::int + (SELECT COUNT(*) FROM templates WHERE user_id = ${user.id})::int AS n`;
    if (n > 0) return console.log(`${email} already has data. Nothing imported.`);

    const seed = readSeed();
    // Every row gets a new id and every file a new name, so the same sample can go to more than one user.
    const ids = new Map<string, string>();
    const fresh = (old: string | null) => (old === null ? null : (ids.get(old) ?? ids.set(old, newId()).get(old)!));
    const position = (rows: Row[], row: Row) => rows.filter((r) => r.message_id === row.message_id).indexOf(row);
    const files = seed.attachments.map((a) => ({ from: a.stored_name, to: newId() + path.extname(a.stored_name), mime: a.mime as string }));

    const messages = seed.messages.map((m) => ({ id: fresh(m.id), user_id: user.id, conversation_id: m.conversation_id, created_at: m.created_at, text: m.text, status: m.status }));
    const attachments = seed.attachments.map((a, i) => ({
      id: fresh(a.id),
      user_id: user.id,
      message_id: fresh(a.message_id),
      position: position(seed.attachments, a),
      kind: a.kind,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      stored_name: files[i].to,
      transcript: a.transcript,
    }));
    const links = seed.links.map((l) => ({
      id: fresh(l.id),
      user_id: user.id,
      message_id: fresh(l.message_id),
      position: position(seed.links, l),
      url: l.url,
      title: l.title,
      description: l.description,
      image: l.image,
      site_name: l.site_name,
    }));
    const items = seed.items.map((i) => ({
      id: fresh(i.id),
      user_id: user.id,
      message_id: fresh(i.message_id),
      position: i.position,
      category: i.category,
      topic: i.topic,
      title: i.title,
      body: i.body,
      attachment_id: fresh(i.attachment_id),
      link_id: fresh(i.link_id),
      done: !!i.done,
    }));
    const templates = seed.templates.map((t) => ({ id: fresh(t.id), user_id: user.id, created_at: t.created_at, prompt: t.prompt, spec: JSON.parse(t.spec) }));

    // Files first, so a message never points at a file that isn't there.
    for (const f of files) await putFile(user.id, "uploads", f.to, fs.readFileSync(path.join(SEED_UPLOADS, f.from)), f.mime);
    await sql.begin(async (tx) => {
      if (messages.length) await tx`INSERT INTO messages ${tx(messages)}`;
      if (attachments.length) await tx`INSERT INTO attachments ${tx(attachments)}`;
      if (links.length) await tx`INSERT INTO links ${tx(links)}`;
      if (items.length) await tx`INSERT INTO items ${tx(items)}`;
      if (templates.length) await tx`INSERT INTO templates ${tx(templates)}`;
    });
    console.log(`Imported ${messages.length} messages, ${attachments.length} files and ${templates.length} templates for ${email}.`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: npm run seed:import <email>");
  await importSeed(email);
}
