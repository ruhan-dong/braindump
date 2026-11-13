# BrainDump

Dump anything into a chat (text, links, images, video, files, voice). It gets turned into a document automatically, in one of two built-in templates, or in templates you describe yourself:

- **📔 Journal:** one magazine-style spread per day: a cover illustration, a serif date headline, then sections instead of a timeline (notes with a drop cap, a to-do checklist, a photo grid, ideas as pull quotes, further reading, voice memos). Wide and narrow sections alternate left and right across a 12-column grid (`arrange()` in `JournalView.tsx`).
- **🗂️ Organized:** a Notion-style page with everything regrouped by intent (to-dos, ideas, saved links, inspiration, moments, notes, files), then by topic.
- **＋ Custom templates:** describe a page in words ("a weekly review of my ideas and notes, in a serif magazine style") and it becomes a new tab. Claude turns the prompt into a template spec (`shared/templates.ts`): which categories to show, grouping (day / week / month / category / topic), layout (list / cards / gallery / checklist / timeline), sort order, and style (font, accent color, density). The app renders your entries with that spec, so a template can't produce a broken page. Without an API key, a keyword matcher builds the spec instead. Templates can be edited (re-prompted) or deleted from their page.

The chat log is the source of truth: the organizer never rewrites your messages. It only adds "items" derived from them, and you can re-run it on any message.

Each person signs up with an email and password and sees only their own log, templates, photo library and files.

## Run

BrainDump keeps accounts, data and uploaded files in a [Supabase](https://supabase.com) project, so you need one before the app will start.

1. Create a project at supabase.com.
2. In its dashboard, under Authentication > URL Configuration, set **Site URL** to `http://localhost:5173`, so the link in the confirmation email comes back to the app.
3. Run the commands below. After copying `.env`, fill in its four Supabase values before going on; the file says where to find each one in the dashboard.

```bash
npm install
cp .env.example .env   # then fill in the Supabase values
npm run db:migrate     # creates the tables and the storage bucket
npm run dev            # http://localhost:5173
```

Open the app and create an account. You need Node 23.4 or newer.

New accounts start with an empty log. The repo ships with sample data in `seed/` (a log, its images and voice memos, and a few custom templates). To copy it into an account that is still empty, run `npm run seed:import you@example.com`.

If you don't set `ANTHROPIC_API_KEY`, a rule-based categorizer is used instead. It handles the obvious cases: links, images, bulleted to-do lists, and "Idea:" prefixes.

To run a production build: `npm run build && npm start`.

`npm run build:demo` builds a shareable page from the sample data in `seed/` as one HTML file, `dist-demo/braindump-demo.html`, with every image inlined. It needs no server and no Supabase project. Viewers can send messages (sorted by the rule-based categorizer in their browser), switch templates, tick to-dos, and change categories. Nothing is saved, so changes reset on reload.

Before opening sign-up to other people: Supabase's built-in email service is meant for testing and only sends a few emails an hour, so set up your own email provider in the dashboard, or turn off email confirmation.

## How it works

| Piece | File |
|---|---|
| HTTP API, uploads, live updates (SSE), Vite dev middleware | `server/index.ts` |
| Who is asking: checks the Supabase sign-in session on every request | `server/auth.ts` |
| Sign-in page and the browser side of the session | `src/components/AuthGate.tsx`, `src/auth.ts` |
| Postgres queries, each limited to the signed-in user: `messages` → `attachments`, `links`, `items` | `server/db.ts` |
| Tables and the storage bucket, applied by `npm run db:migrate` | `supabase/migrations/`, `server/migrate.ts` |
| Uploaded files and thumbnails, in a private bucket | `server/storage.ts` |
| Sample data: import into an account, and the source of the demo page | `server/seed.ts` |
| Link previews (Open Graph) | `server/links.ts` |
| Categorizer: Claude with structured output, plus the rule fallback | `server/classify.ts` |
| Category list (shared by server and UI) | `shared/categories.ts` |
| Rule-based categorizer: splits a message into one item per intent | `shared/rules.ts` |
| Template spec + keyword fallback; Claude template generator | `shared/templates.ts`, `server/templates.ts` |
| Template page and prompt dialog | `src/components/TemplateView.tsx`, `TemplateDialog.tsx` |
| Chat log + composer (paste, drag-drop, voice) | `src/components/Chat.tsx`, `Composer.tsx` |
| Templates | `src/components/JournalView.tsx`, `OrganizedView.tsx` |

Pipeline per message: save the raw message and files → fetch link previews → classify into items (one message can produce several items, e.g. two to-dos and a link) → push the update to the browser.

Voice memos are recorded in the browser. While recording, the browser's Web Speech API (Chrome, Edge, Safari) produces a transcript, and that transcript is what gets categorized.

Data lives in the Supabase project: rows in Postgres, and files in the private `media` bucket under each user's id. Row level security is on with no policies and the bucket has none either, so neither can be read from a browser. Everything goes through this server, which checks the session first. A file's address (`/uploads/<name>`) only works for its owner: the server redirects them to a link for that one file that expires in an hour.
