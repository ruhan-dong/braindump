# BrainDump

Dump anything into a chat (text, links, images, video, files, voice). It gets turned into a document automatically, in one of two built-in templates, or in templates you describe yourself:

- **📔 Journal:** one magazine-style spread per day: a cover illustration, a serif date headline, then sections instead of a timeline (notes with a drop cap, a to-do checklist, a photo grid, ideas as pull quotes, further reading, voice memos). Wide and narrow sections alternate left and right across a 12-column grid (`arrange()` in `JournalView.tsx`).
- **🗂️ Organized:** a Notion-style page with everything regrouped by intent (to-dos, ideas, saved items, inspiration, moments, notes, files), then by topic.
- **＋ Custom templates:** describe a page in words ("a weekly review of my ideas and notes, in a serif magazine style") and it becomes a new tab. Claude turns the prompt into a template spec (`shared/templates.ts`): which categories to show, grouping (day / week / month / category / topic), layout (list / cards / gallery / checklist / timeline), sort order, and style (font, accent color, density). The app renders your entries with that spec, so a template can't produce a broken page. Without an API key, a keyword matcher builds the spec instead. Templates can be edited (re-prompted) or deleted from their page.

The chat log is the source of truth: the organizer never rewrites your messages. It only adds "items" derived from them, and you can re-run it on any message.

Each person signs up with an email and password and sees only their own log, templates, photo library and files. A forgotten password is reset through a link sent by email.

## Run

BrainDump keeps accounts, data and uploaded files in a Supabase project, so you need one before the app will start.

1. Create a project at supabase.com.
2. In its dashboard, under Authentication > URL Configuration, set **Site URL** to `http://localhost:5173`, so the link in the confirmation email comes back to the app.
3. In the dashboard's Authentication email templates, replace the link in two of them, so the emails link straight to the app. With Supabase's own links, the confirmation link only signs people in from the browser they signed up in, and the reset link never asks for a new password.
   - **Confirm signup**: `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Confirm email address</a>`
   - **Reset password**: `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>`
4. Run the commands below. After copying `.env`, fill in its four Supabase values before going on; the file says where to find each one in the dashboard.

```bash
npm install
cp .env.example .env   # then fill in the Supabase values
npm run db:migrate     # creates the tables and the storage bucket
npm run dev            # http://localhost:5173
```

Open the app and create an account. You need Node 23.4 or newer.

New accounts start with an empty log and four starter templates (Weekly review, Reading list, Moodboard gallery, Open to-dos), added by the database when the account is created (`supabase/migrations/0003_starter_templates.sql`, updated by `0004_open_todos_title.sql`). Until the first message is sent, the Log shows three days of faded example messages (`src/samples.ts`), and Journal, Organized and the templates show the entries those messages were sorted into, so it is clear how the app works. The examples are not saved: they leave the Log, Journal and Organized with the first real message, and a template once a real entry fits it. The repo ships with sample data in `seed/` (a log, its images and voice memos, and the same four templates). To copy it into an account that has no notes yet, run `npm run seed:import you@example.com`.

If you don't set `ANTHROPIC_API_KEY`, a rule-based categorizer is used instead. It handles the obvious cases: links, images, bulleted to-do lists, and "Idea:" prefixes.

To run a production build: `npm run build && npm start`.

`npm run build:demo` builds a shareable page from the sample data in `seed/` as one HTML file, `dist-demo/braindump-demo.html`, with every image inlined. It needs no server and no Supabase project. Viewers can send messages (sorted by the rule-based categorizer in their browser), switch templates, tick to-dos, and change categories. Nothing is saved, so changes reset on reload.

Before opening sign-up to other people: Supabase's built-in email service is meant for testing and only sends a few emails an hour, so set up your own email provider in the dashboard, or turn off email confirmation.

## Deploy on Railway

BrainDump runs on any host with Node 23.4 or newer: build with `npm run build`, start with `npm start`. The build needs the dev dependencies (Vite is one of them); the running server does not. The steps below are for Railway.

1. In Railway, create a project from the GitHub repo. It finds the build and start commands in `package.json`.
2. Under the service's Variables, set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to the same values as in `.env`. Leave `PORT` out, because Railway provides it. `ANTHROPIC_API_KEY` is optional, as it is locally.
3. Under Settings > Deploy, set Custom Start Command to `npm run start`. Railway serves a project with a Vite config as a static site unless it has a start command. The `start` script already counts as one, and setting it here means that no longer depends on detection.
4. Under Settings > Scale, pick the region closest to your Supabase project. Under Settings > Networking, generate a domain.
5. In the Supabase dashboard, under Authentication > URL Configuration, set **Site URL** to the Railway address and add `http://localhost:5173` to **Redirect URLs**. Confirmation emails then link back to the right place from both the deployed app and local development.

Every push to `main` deploys again. A deploy does not run database migrations, developers need to run `npm run db:migrate` manually:

A deploy only builds and restarts the server, and the database lives in Supabase, so it stays as it was. Run the migration whenever a change adds a file to `supabase/migrations/`. For a change that only adds tables or columns, run it before merging: new code that goes live ahead of its migration fails until the migration has run. If your local `.env` has the same `DATABASE_URL` as the deployed app, running it locally updates the production database.

To have Railway run it instead, add `npm run db:migrate` as a pre-deploy step under Settings > Deploy. It then runs after each build and before the new version starts, and a failed migration stops the deploy.

## How it works

| Piece | File |
|---|---|
| HTTP API, uploads, live updates (SSE), Vite dev middleware | `server/index.ts` |
| Who is asking: checks the Supabase sign-in session on every request | `server/auth.ts` |
| Sign-in page and the browser side of the session | `src/components/AuthGate.tsx`, `src/auth.ts` |
| Postgres queries, each limited to the signed-in user: `messages` → `attachments`, `links`, `items` | `server/db.ts` |
| Tables and the storage bucket, applied by `npm run db:migrate` | `supabase/migrations/`, `server/migrate.ts` |
| Uploaded files, link preview pictures and thumbnails, in a private bucket | `server/storage.ts` |
| Sample data: import into an account, and the source of the demo page | `server/seed.ts` |
| Link previews (Open Graph), and the download of their pictures | `server/links.ts` |
| Categorizer: Claude with structured output, plus the rule fallback | `server/classify.ts` |
| Category list (shared by server and UI) | `shared/categories.ts` |
| Rule-based categorizer: splits a message into one item per intent | `shared/rules.ts` |
| Template spec + keyword fallback; Claude template generator | `shared/templates.ts`, `server/templates.ts` |
| Template page and prompt dialog | `src/components/TemplateView.tsx`, `TemplateDialog.tsx` |
| Chat log + composer (paste, drag-drop, voice) | `src/components/Chat.tsx`, `Composer.tsx` |
| Templates | `src/components/JournalView.tsx`, `OrganizedView.tsx` |

Pipeline per message: save the raw message and files → fetch link previews → classify into items (one message can produce several items, e.g. two to-dos and a link) → push the update to the browser.

A link's preview is fetched once, when the message is sent: the page's title, description and site name, and its picture (`og:image` or `twitter:image`, or the link itself when it points straight at a picture). The picture is downloaded by the server and kept with the person's own files, so a saved link keeps showing it even if the site later changes it, removes it, or refuses to serve it to other sites, and the site never sees who looks at the link afterwards. Only JPEG, PNG, GIF, WebP and AVIF pictures up to 5 MB are kept; anything else, or a download that fails, saves the link without a picture. Both the page and the picture are fetched from the public internet only, never from the server's own machine or network. Sorting a message again ("Recategorize with AI") keeps the saved preview instead of fetching a new one. Links saved before pictures were kept still load theirs from the other site.

Voice memos are recorded in the browser. While recording, the browser's Web Speech API (Chrome, Edge, Safari) produces a transcript, and that transcript is what gets categorized.

Data lives in the Supabase project: rows in Postgres, and files in the private `media` bucket under each user's id. Row level security is on with no policies and the bucket has none either, so neither can be read from a browser. Everything goes through this server, which checks the session first. A file's address (`/uploads/<name>`, for an attachment or a link's picture) only works for its owner: the server redirects them to a link for that one file that expires in an hour.
