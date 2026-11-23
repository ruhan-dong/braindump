// Custom templates: the user describes a page in words, and it is turned into this spec (by Claude, or by
// keyword rules when no API key is set). The app renders the user's items with the spec, so a template
// can't produce a broken page.
import type { CategoryId } from "./categories.ts";

export const GROUP_BY = ["none", "day", "week", "month", "category", "topic"] as const;
export const LAYOUTS = ["list", "cards", "gallery", "checklist", "timeline"] as const;
export const FONTS = ["sans", "serif", "mono"] as const;
export const ACCENTS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;

export type TemplateSpec = {
  name: string; // tab label, 1-3 words
  emoji: string;
  title: string; // page heading
  subtitle: string;
  include: CategoryId[]; // empty = every category
  groupBy: (typeof GROUP_BY)[number];
  sort: "newest" | "oldest";
  layout: (typeof LAYOUTS)[number];
  hideDone: boolean;
  showTime: boolean;
  style: { font: (typeof FONTS)[number]; accent: (typeof ACCENTS)[number]; density: (typeof DENSITIES)[number] };
  note: string; // what couldn't be matched exactly, shown to the user; empty when everything fit
};

export type Template = { id: string; created_at: number; prompt: string; spec: TemplateSpec };

// ---------- Keyword fallback (no API key, and the static demo) ----------

const has = (text: string, re: RegExp) => re.test(text);

const CATEGORY_WORDS: [CategoryId, RegExp][] = [
  ["todo", /\b(to-?dos?|tasks?|checklist|errands?)\b/],
  ["idea", /\bideas?\b/],
  ["link", /\b(links?|reading|read later|articles?|bookmarks?|saved|websites?)\b/],
  ["inspiration", /\b(inspo|inspiration|moodboard|design|visuals?|references?)\b/],
  ["moment", /\b(photos?|pictures?|moments?|memories)\b/],
  ["note", /\b(notes?|thoughts?|reflections?|journal(ing)?|diary)\b/],
  ["file", /\b(files?|documents?|pdfs?)\b/],
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A rough spec from keywords in the prompt. Good enough for clear requests; Claude handles the rest. */
export function templateFromKeywords(prompt: string): TemplateSpec {
  const p = prompt.toLowerCase();
  const include = CATEGORY_WORDS.filter(([, re]) => has(p, re)).map(([id]) => id);

  const groupBy: TemplateSpec["groupBy"] = has(p, /\bweek(ly)?\b/)
    ? "week"
    : has(p, /\bmonth(ly)?\b/)
      ? "month"
      : has(p, /\b(day|daily|per day)\b/)
        ? "day"
        : has(p, /\b(topics?|themes?|projects?)\b/)
          ? "topic"
          : has(p, /\b(categor(y|ies)|types?|kinds?)\b/)
            ? "category"
            : "none";

  const layout: TemplateSpec["layout"] = has(p, /\b(gallery|moodboard|grid|visual|pinterest)\b/)
    ? "gallery"
    : has(p, /\btimeline|chronolog/)
      ? "timeline"
      : has(p, /\b(checklist|to-?do list|task list)\b/) || (include.length === 1 && include[0] === "todo")
        ? "checklist"
        : has(p, /\b(cards?|board|kanban)\b/)
          ? "cards"
          : has(p, /\blist\b/)
            ? "list"
            : include.length === 1 && include[0] === "inspiration"
              ? "gallery"
              : "cards";

  const font: TemplateSpec["style"]["font"] = has(p, /\b(serif|magazine|editorial|elegant|book)\b/)
    ? "serif"
    : has(p, /\b(mono|monospace|code|terminal|typewriter)\b/)
      ? "mono"
      : "sans";
  const accent = ACCENTS.find((c) => has(p, new RegExp(`\\b${c === "gray" ? "gr[ae]y" : c}\\b`))) ?? "gray";

  // Title: the request minus filler ("make me a…") and minus how it should look (", in a serif style") or be
  // grouped ("grouped by topic"): a page only splits into groups when its entries give it something to split by.
  const what = prompt
    .replace(/^\s*(please\s+)?(make|create|build|give|show)(\s+me)?\s+/i, "")
    .replace(/^\s*(a|an|the|my)\s+/i, "")
    .split(/,|\s+grouped\s+by\s+|\s+(?:in|as|with|using)\s+(?:a|an)\s+/i)[0]
    .replace(/[.!?]+$/, "")
    .trim();
  // Tab name: the head of that phrase, up to the first connecting word ("Weekly review of my…" → "Weekly review").
  const head = what.split(/\s+(?:of|for|from|with|grouped|by|that|which|in|on|about|to)\s+/i)[0];
  const name = capitalize(head.split(/\s+/).slice(0, 3).join(" ")) || "My template";

  return {
    name,
    emoji: layout === "gallery" ? "🖼️" : layout === "checklist" ? "☑️" : groupBy === "week" ? "🗓️" : include[0] === "link" ? "📚" : "✨",
    title: capitalize(what) || name,
    subtitle: "",
    include,
    groupBy,
    sort: has(p, /\b(oldest|chronological|in order)\b/) ? "oldest" : "newest",
    layout,
    hideDone: has(p, /\b(open|unfinished|pending|not done|remaining)\b/),
    showTime: !has(p, /\b(no|without|hide) (times?|dates?)\b/),
    style: { font, accent, density: has(p, /\b(compact|dense|minimal|tight)\b/) ? "compact" : "comfortable" },
    note: "",
  };
}
