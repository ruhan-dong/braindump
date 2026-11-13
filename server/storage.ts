// Uploaded files and photo thumbnails, kept in a private Supabase Storage bucket (see supabase/migrations/0002_storage.sql).
// Every function takes the user's id first and only reaches files under that id, so one user can never be handed
// another's file, even with its exact name.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are not set. Copy .env.example to .env and fill in the Supabase values.");

const bucket = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from("media");

/** uploads: files attached to messages. thumbs: thumbnails of the photo library. */
export type Folder = "uploads" | "thumbs";

const keyOf = (userId: string, folder: Folder, name: string) => `${userId}/${folder}/${name}`;

export async function putFile(userId: string, folder: Folder, name: string, body: Blob | Buffer, mime: string) {
  // For a Blob the library sends the Blob's own type and ignores contentType, so the type has to be on the Blob.
  if (body instanceof Blob && body.type !== mime) body = body.slice(0, body.size, mime);
  const { error } = await bucket.upload(keyOf(userId, folder, name), body, { contentType: mime });
  if (error) throw new Error(`Could not store ${folder}/${name}: ${error.message}`);
}

export async function readFile(userId: string, folder: Folder, name: string): Promise<Buffer> {
  const { data, error } = await bucket.download(keyOf(userId, folder, name));
  if (error) throw new Error(`Could not read ${folder}/${name}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeFiles(userId: string, folder: Folder, names: string[]) {
  if (names.length === 0) return;
  const keys = names.map((n) => keyOf(userId, folder, n));
  for (const key of keys) links.delete(key);
  const { error } = await bucket.remove(keys);
  if (error) console.error(`[storage] could not delete ${names.length} file(s) in ${folder}:`, error.message);
}

const LINK_SECONDS = 60 * 60;
// A link is reused for most of its life, so a page shows the same address each time and the browser can cache the file.
const links = new Map<string, { url: string; until: number }>();

/** A link to one of the user's files that works for an hour, or null if they have no such file. */
export async function fileLink(userId: string, folder: Folder, name: string): Promise<string | null> {
  const key = keyOf(userId, folder, name);
  const known = links.get(key);
  if (known && known.until > Date.now()) return known.url;
  const { data, error } = await bucket.createSignedUrl(key, LINK_SECONDS);
  if (error) return null;
  if (links.size > 5000) for (const [k, v] of links) if (v.until <= Date.now()) links.delete(k);
  links.set(key, { url: data.signedUrl, until: Date.now() + (LINK_SECONDS - 10 * 60) * 1000 });
  return data.signedUrl;
}
