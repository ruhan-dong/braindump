import "./env.ts";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import * as db from "./db.ts";
import { authConfig, requireUser, userOf } from "./auth.ts";
import { classify } from "./classify.ts";
import { aiEnabled } from "./claude.ts";
import { generateTemplate } from "./templates.ts";
import { fetchPreview } from "./links.ts";
import { extractUrls } from "../shared/rules.ts";
import { isRecallQuery, photoName, recallTerms, searchPhotos, todoFromPhoto, wantsNote, wantsTodo } from "../shared/recall.ts";
import { CATEGORY_IDS } from "../shared/categories.ts";

const PORT = Number(process.env.PORT ?? 5173);
const isProd = process.env.NODE_ENV === "production";
const app = express();
app.use(express.json());

// ---------- Live updates (Server-Sent Events) ----------
// Each user's open pages. An update goes only to the pages of the user it belongs to.
const clients = new Map<string, Set<express.Response>>();
function broadcast(userId: string, event: object) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients.get(userId) ?? []) res.write(payload);
}
const pushMessage = async (userId: string, id: string) => {
  const message = await db.getMessage(userId, id);
  if (message) broadcast(userId, { type: "message", message });
};

/** Copies a photo from the library into the log as a new message, with the text read from it. */
async function photoMessage(userId: string, photo: db.Photo): Promise<db.Message> {
  const storedName = db.newId() + ".jpg";
  fs.copyFileSync(path.join(db.THUMB_DIR, path.basename(photo.url)), db.storedPath(storedName));
  return db.insertMessage(userId, "", [
    {
      kind: "image",
      filename: path.basename(photo.path),
      mime: "image/jpeg",
      size: fs.statSync(db.storedPath(storedName)).size,
      storedName,
      transcript: photo.text.trim() || null,
    },
  ]);
}

// ---------- Organizing pipeline ----------
/** Runs in the background after a message is saved. Never rejects: a failure is recorded on the message. */
async function organize(userId: string, id: string) {
  try {
    try {
      const msg = await db.getMessage(userId, id);
      if (!msg) return;
      // A question can be typed or spoken: a voice memo alone counts by its transcript.
      const voiceOnly = msg.attachments.length > 0 && msg.attachments.every((a) => a.kind === "audio");
      const asked = [msg.text, ...(voiceOnly ? msg.attachments.map((a) => a.transcript ?? "") : [])].join(" ").trim();
      if (isRecallQuery(asked) && (msg.attachments.length === 0 || voiceOnly)) {
        // "Can you find that screenshot…": answer from the photo library instead of filing it as a note.
        const terms = recallTerms(asked);
        const photos = await db.listPhotos(userId);
        const found = searchPhotos(photos, terms);
        await db.saveRecall(userId, id, terms, found.map((m) => m.photo.id), photos.length);
        // "…and make a to-do with the day and time": file the best match as a to-do on this message.
        const todo = wantsTodo(asked) && found.length ? todoFromPhoto(found[0].photo, asked, terms) : null;
        await db.replaceItems(userId, id, todo ? [{ category: "todo", topic: null, title: todo.title, body: todo.body, attachment_id: null, link_id: null }] : []);
        // "…and add it to my notes": save the best match into the log as one note (not re-sorted, so its times don't
        // turn into extra to-dos next to the one above).
        if (wantsNote(asked) && found.length) {
          const best = found[0].photo;
          const saved = await photoMessage(userId, best);
          const title = photoName(best, asked, terms);
          const body = best.text.split("\n").filter((l) => /\p{Ll}{3,}/u.test(l)).join("\n"); // drop OCR specks like "SRR INR La,"
          await db.replaceItems(userId, saved.id, [{ category: "note", topic: null, title, body, attachment_id: saved.attachments[0].id, link_id: null }]);
          await db.setStatus(userId, saved.id, "done");
          await pushMessage(userId, saved.id);
        }
      } else {
        await db.replaceLinks(userId, id, await Promise.all(extractUrls(msg.text).map(fetchPreview)));
        await pushMessage(userId, id); // show link previews as soon as they're ready
        await db.replaceItems(userId, id, await classify(userId, (await db.getMessage(userId, id))!));
      }
      await db.setStatus(userId, id, "done");
    } catch (err) {
      console.error(`[organize] ${id}:`, err);
      await db.setStatus(userId, id, "error");
    }
    await pushMessage(userId, id);
  } catch (err) {
    console.error(`[organize] ${id}: could not save the result:`, err);
  }
}

// ---------- API ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: db.UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, db.newId() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const kindOf = (mime: string) =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";

// Public: the page needs this before anyone has signed in.
app.get("/api/status", (_req, res) => res.json({ ai: aiEnabled, ...authConfig }));

// Everything below belongs to one user: their notes, templates, photo library and files.
app.use(["/api", "/uploads", "/thumbs"], requireUser);

app.get("/api/events", (req, res) => {
  const userId = userOf(res);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const mine = clients.get(userId) ?? new Set();
  clients.set(userId, mine.add(res));
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    mine.delete(res);
    if (mine.size === 0) clients.delete(userId);
  });
});

app.get("/api/messages", async (_req, res) => res.json(await db.listMessages(userOf(res))));

app.post("/api/messages", upload.array("files"), async (req, res) => {
  const userId = userOf(res);
  const files = (req.files as Express.Multer.File[]) ?? [];
  const transcripts: (string | null)[] = JSON.parse(req.body.transcripts ?? "[]");
  const text = String(req.body.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text && files.length === 0) return res.status(400).json({ error: "Empty message" });

  const message = await db.insertMessage(
    userId,
    text,
    files.map((f, i) => ({
      kind: kindOf(f.mimetype),
      // multer decodes multipart filenames as latin1; restore UTF-8 (e.g. Chinese names).
      filename: Buffer.from(f.originalname, "latin1").toString("utf8"),
      mime: f.mimetype,
      size: f.size,
      storedName: f.filename,
      transcript: transcripts[i]?.trim() || null,
    })),
  );
  res.status(201).json(message);
  broadcast(userId, { type: "message", message });
  organize(userId, message.id);
});

app.post("/api/messages/:id/reorganize", async (req, res) => {
  const userId = userOf(res);
  if (!(await db.getMessage(userId, req.params.id))) return res.sendStatus(404);
  await db.setStatus(userId, req.params.id, "pending");
  await pushMessage(userId, req.params.id);
  organize(userId, req.params.id);
  res.sendStatus(202);
});

app.delete("/api/messages/:id", async (req, res) => {
  const userId = userOf(res);
  for (const f of await db.deleteMessage(userId, req.params.id)) fs.rm(db.storedPath(f), { force: true }, () => {});
  broadcast(userId, { type: "deleted", id: req.params.id });
  res.sendStatus(204);
});

app.patch("/api/items/:id", async (req, res) => {
  const userId = userOf(res);
  const { done, category } = req.body ?? {};
  if (category !== undefined && !CATEGORY_IDS.includes(category)) return res.status(400).json({ error: "Unknown category" });
  const messageId = await db.updateItem(userId, req.params.id, { done: done === undefined ? undefined : Boolean(done), category });
  if (!messageId) return res.sendStatus(404);
  await pushMessage(userId, messageId);
  res.sendStatus(204);
});

app.get("/api/templates", async (_req, res) => res.json(await db.listTemplates(userOf(res))));

app.post("/api/templates", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "Describe the page you want." });
  res.status(201).json(await db.insertTemplate(userOf(res), prompt, await generateTemplate(prompt)));
});

app.put("/api/templates/:id", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "Describe the page you want." });
  const template = await db.updateTemplate(userOf(res), req.params.id, prompt, await generateTemplate(prompt));
  if (!template) return res.sendStatus(404);
  res.json(template);
});

app.delete("/api/templates/:id", async (req, res) => {
  await db.deleteTemplate(userOf(res), req.params.id);
  res.sendStatus(204);
});

// ---------- Photo library ----------
// The browser reads each photo (text, date, place) and sends only that plus a thumbnail; originals stay on disk.
const thumbUpload = multer({
  storage: multer.diskStorage({ destination: db.THUMB_DIR, filename: (_req, _file, cb) => cb(null, db.newId() + ".jpg") }),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const removeThumb = (name: string) => fs.rm(path.join(db.THUMB_DIR, name), { force: true }, () => {});

app.get("/api/photos", async (_req, res) => res.json({ folders: await db.photoFolders(userOf(res)) }));

app.get("/api/photos/known", async (req, res) => res.json(await db.knownPhotoKeys(userOf(res), String(req.query.folder ?? ""))));

app.post("/api/photos", thumbUpload.single("thumb"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing thumbnail" });
  const meta = JSON.parse(req.body.meta ?? "{}");
  if (!meta.folder || !meta.path) {
    removeThumb(req.file.filename);
    return res.status(400).json({ error: "Missing folder or path" });
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const replaced = await db.upsertPhoto(userOf(res), {
    folder: String(meta.folder),
    path: String(meta.path),
    size: Number(meta.size) || 0,
    modified_at: Number(meta.modified_at) || 0,
    taken_at: num(meta.taken_at),
    lat: num(meta.lat),
    lon: num(meta.lon),
    text: String(meta.text ?? "").slice(0, 20_000),
    thumb_name: req.file.filename,
  });
  if (replaced) removeThumb(replaced);
  res.sendStatus(201);
});

app.delete("/api/photos", async (req, res) => {
  for (const t of await db.deletePhotoFolder(userOf(res), String(req.query.folder ?? ""))) removeThumb(t);
  res.sendStatus(204);
});

/** "Save to my notes": posts a found photo into the log, with the text read from it, so it gets sorted. */
app.post("/api/photos/:id/save", async (req, res) => {
  const userId = userOf(res);
  const photo = await db.getPhoto(userId, req.params.id);
  if (!photo) return res.sendStatus(404);
  const message = await photoMessage(userId, photo);
  res.status(201).json(message);
  broadcast(userId, { type: "message", message });
  organize(userId, message.id);
});

app.use("/thumbs", express.static(db.THUMB_DIR, { maxAge: "7d" }));
app.use("/uploads", express.static(db.UPLOAD_DIR, { maxAge: "7d" }));

// ---------- Frontend ----------
if (isProd) {
  app.use(express.static("dist"));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(PORT, async () => {
  console.log(`BrainDump running at http://localhost:${PORT}  (AI organizer: ${aiEnabled ? "Claude" : "rules only — set ANTHROPIC_API_KEY to enable"})`);
  // Resume anything that was mid-organize when the server last stopped.
  for (const m of await db.pendingMessages()) organize(m.user_id, m.id);
});
