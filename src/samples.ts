// Example messages for an account with nothing in it yet, so the Log and the Notebook show how the app works
// instead of being blank. It is one set, three days of it: the Log shows the messages, and every Notebook page shows
// the entries they were sorted into, so each message can be found on the pages and each entry back in the Log.
// They are drawn like real ones, faded (.sample in styles.css), and are never saved: a page stops asking for them
// once the person has something of their own for it.
import type { MouseEvent } from "react";
import type { Attachment, Link, Message } from "./api.ts";
import type { CategoryId } from "../shared/categories.ts";
import { COVERS } from "./covers.ts";
import bulletJournal from "./assets/samples/bullet-journal.png";
import github from "./assets/samples/github.png";

/**
 * One message and the entry it was sorted into. `at` is when it was sent: days ago, hour, minute.
 * `text` is what the Log shows, when that isn't the link's address or else the title. `site` is the name of the
 * link's website. `image` is the picture that was sent, or on a link its preview picture, kept in the app so nobody's
 * browser has to fetch it from the website.
 */
type Sample = { category: CategoryId; title: string; text?: string; body?: string; done?: boolean; at: [number, number, number]; image?: string; url?: string; site?: string; file?: string };

// No moments, and the fig is left out: there are four pictures to go around, and Organized has the fig as its cover.
// No topics either, so no page splits a category into topic groups. Two to-dos are done, to show how those are set aside.
const SAMPLES: Sample[] = [
  { category: "note", title: "Mornings go better when the phone stays in the other room", at: [3, 8, 10] },
  { category: "todo", title: "Book the dentist appointment", done: true, at: [3, 9, 40] },
  { category: "inspiration", title: "Night-sky pattern for the invitation", at: [3, 11, 5], image: COVERS.moon },
  { category: "link", title: "Beginner's Sourdough Guide: Everything You Need to Start Baking", text: "https://sourdoughtalk.com/beginners-sourdough-guide/ for the weekend", body: "For the weekend", at: [3, 13, 20], url: "https://sourdoughtalk.com/beginners-sourdough-guide/", site: "sourdoughtalk.com" },
  { category: "idea", title: "A recipe app that plans around what's already in the fridge", at: [3, 18, 30] },

  { category: "todo", title: "Send the slides to Maya", done: true, at: [2, 8, 45] },
  { category: "inspiration", title: "Warm colored-pencil texture", at: [2, 10, 15], image: COVERS.toast },
  { category: "link", title: "anthropics/anthropic-sdk-typescript", at: [2, 12, 10], url: "https://github.com/anthropics/anthropic-sdk-typescript", site: "GitHub", image: github },
  { category: "idea", title: "Turn the hallway closet into a reading nook", at: [2, 14, 0] },
  { category: "todo", title: "Reply to the venue about the date", at: [2, 16, 45] },
  { category: "note", title: "Felt calmer after the long walk this afternoon", at: [2, 19, 45] },

  { category: "idea", title: "A weekly newsletter of the best things I read", at: [1, 9, 30] },
  { category: "note", title: "The best meetings this week had a written agenda", at: [1, 11, 20] },
  { category: "file", title: "Lease agreement", text: "", at: [1, 14, 0], file: "lease-agreement.pdf" },
  { category: "inspiration", title: "Pink and orange color palette", at: [1, 16, 30], image: COVERS.car },
  { category: "todo", title: "Renew the car insurance", text: "Renew the car insurance, due by the end of the month", body: "Due by the end of the month", at: [1, 18, 15] },
  { category: "link", title: "Bullet journal - Wikipedia", at: [1, 20, 10], url: "https://en.wikipedia.org/wiki/Bullet_journal", site: "Wikipedia", image: bulletJournal },
];

/** True for an example message or entry: the ids of both are "sample-" and a number. */
export const isExample = (id: string) => id.startsWith("sample-");

/**
 * What the element around examples gets, spread onto it: they are faded, and a click on them does nothing.
 * With `jumps`, two things still work, to show how the Log and the Notebook line up: a label's menu in the Log
 * (Show in Notebook) and the arrow on a Notebook entry (show the original message). A page passes false when the
 * other side isn't showing the examples, so there is nothing to jump to.
 */
export function exampleProps(on: boolean, jumps = true) {
  if (!on) return {};
  return {
    className: jumps ? "sample" : "sample no-jumps",
    onClickCapture: (e: MouseEvent) => {
      if (jumps && (e.target as Element).closest(".tag-menu, .item-actions button")) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/** The example messages, oldest first like the real log. Each holds one entry. */
export function sampleMessages(): Message[] {
  const today = new Date();
  return SAMPLES.map((s, i): Message => {
    const id = `sample-${i}`;
    const [daysAgo, hour, minute] = s.at;
    // The file name differs from the title, or the pages would take the title for a bare file name and hide it.
    const attachment: Attachment | undefined = s.url
      ? undefined
      : s.image
        ? { id, kind: "image", filename: "example.webp", mime: "image/webp", size: 0, url: s.image, transcript: null }
        : s.file
          ? { id, kind: "file", filename: s.file, mime: "application/pdf", size: 248_000, url: "", transcript: null }
          : undefined;
    const link: Link | undefined = s.url ? { id, url: s.url, title: s.title, description: null, image: s.image ?? null, site_name: s.site ?? null } : undefined;
    return {
      id,
      created_at: new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).getTime(),
      text: s.text ?? s.url ?? s.title,
      status: "done",
      attachments: attachment ? [attachment] : [],
      links: link ? [link] : [],
      items: [{ id, category: s.category, topic: null, title: s.title, body: s.body ?? "", attachment_id: attachment?.id ?? null, link_id: link?.id ?? null, done: !!s.done }],
    };
  });
}
