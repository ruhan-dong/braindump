// Builds a self-contained snapshot of the app, filled with the sample data in seed/, as one HTML page that can be
// shared (e.g. published as a claude.ai Artifact). Usage: npm run build:demo → dist-demo/braindump-demo.html
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { SEED_UPLOADS, seedMessages, seedTemplates } from "./server/seed.ts";

const toDataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString("base64")}`;

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !mime.startsWith("image/")) return null;
    return toDataUri(Buffer.from(await res.arrayBuffer()), mime);
  } catch {
    return null;
  }
}

/** The sample log with every upload and link preview image inlined, so the page needs no server. */
async function snapshot() {
  const messages = seedMessages();
  for (const m of messages) {
    for (const a of m.attachments) a.url = toDataUri(fs.readFileSync(path.join(SEED_UPLOADS, path.basename(a.url))), a.mime);
    for (const l of m.links) if (l.image) l.image = await fetchAsDataUri(l.image);
  }
  return messages;
}

/** Collapses the build into a single page body (the Artifact host adds <html>/<head>/<body> itself). */
function singlePage(): Plugin {
  return {
    name: "single-page",
    enforce: "post",
    generateBundle(_opts, bundle) {
      let css = "";
      let js = "";
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type === "asset" && name.endsWith(".css")) css += out.source;
        if (out.type === "chunk" && out.isEntry) js += out.code;
        delete bundle[name];
      }
      const html = `<meta charset="utf-8">
<title>BrainDump</title>
<meta name="description" content="BrainDump demo: quick notes, links and screenshots sorted automatically into a daily journal and organized pages.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Noto+Serif+SC:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>
`;
      this.emitFile({ type: "asset", fileName: "braindump-demo.html", source: html });
    },
  };
}

export default defineConfig(async () => {
  return {
    plugins: [react(), singlePage()],
    define: { __SNAPSHOT__: JSON.stringify(await snapshot()), __TEMPLATES__: JSON.stringify(seedTemplates()) },
    resolve: { alias: [{ find: /^(\.\.?\/)+api\.ts$/, replacement: path.resolve("src/demo/api.ts") }] },
    build: { outDir: "dist-demo", emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Infinity },
  };
});
