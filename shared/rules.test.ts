// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyWithRules } from "./rules.ts";

/** What the rule-based categorizer makes of a typed message, as "category:Title" strings. */
const sort = (text: string) =>
  classifyWithRules({ id: "m", created_at: 0, text, status: "done", attachments: [], links: [], items: [] }).map(
    (i) => `${i.category}:${i.title}`,
  );

const cases: [string, string[]][] = [
  // Lists and checkboxes
  ["1. Email Maya\n2. Book the venue\n3. Order cake", ["todo:Email Maya", "todo:Book the venue", "todo:Order cake"]],
  ["2) Call the bank", ["todo:Call the bank"]],
  ["Groceries:\n- Figs\n- Oat milk\n- Eggs", ["todo:Figs", "todo:Oat milk", "todo:Eggs"]],
  ["Packing list:\n- passport\n- charger", ["todo:Passport", "todo:Charger"]],
  ["- [ ] figs", ["todo:Figs"]],
  ["[x] pay rent", ["todo:Pay rent"]],
  ["☐ book flights", ["todo:Book flights"]],
  ["✅ renew passport", ["todo:Renew passport"]],
  ["- Loved the movie\n- Email Maya the photos", ["note:Loved the movie", "todo:Email Maya the photos"]],
  ["Packing:\n- passport\n- charger", ["note:Packing: - passport - charger"]],
  // Labels and statuses
  ["Reminder: dentist at 4", ["todo:Dentist at 4"]],
  ["pending: send the invoice", ["todo:Send the invoice"]],
  ["report (in progress)", ["todo:Report"]],
  ["Pay rent - done", ["todo:Pay rent"]],
  // Deadlines and priorities
  ["slides by Friday", ["todo:Slides by Friday"]],
  ["Rent is due Friday", ["todo:Rent is due Friday"]],
  ["Fix the bug ASAP", ["todo:Fix the bug ASAP"]],
  ["Send the deck by EOD", ["todo:Send the deck by EOD"]],
  ["P1 invoice for Acme", ["todo:P1 invoice for Acme"]],
  ["follow up with Sam about the deck", ["todo:Follow up with Sam about the deck"]],
  ["urgent: fix the login bug", ["todo:Urgent: fix the login bug"]],
  // Unchanged to-dos
  ["Buy milk. Call mom tomorrow.", ["todo:Buy milk", "todo:Call mom tomorrow"]],
  ["Meeting with Rohan at 1", ["todo:Meeting with Rohan at 1"]],
  ["I need to send it by Friday", ["todo:Send it by Friday"]],
  // Not to-dos
  ["I should have known better", ["note:I should have known better"]],
  ["That movie must be amazing", ["note:That movie must be amazing"]],
  ["The meeting today was important", ["note:The meeting today was important"]],
  ["I finished the report by Friday", ["note:I finished the report by Friday"]],
  ["We shipped it before Friday", ["note:We shipped it before Friday"]],
  ["Due to the rain we stayed in", ["note:Due to the rain we stayed in"]],
  ["Today was long", ["note:Today was long"]],
  ["I'm finally done with that show", ["note:I'm finally done with that show"]],
  ["- Felt tired after the gym", ["note:Felt tired after the gym"]],
  ["Version 2. Launch went fine", ["note:Version 2. Launch went fine"]],
  ["What if the app could read my calendar", ["idea:What if the app could read my calendar"]],
];

for (const [text, expected] of cases) {
  test(JSON.stringify(text), () => assert.deepEqual(sort(text), expected));
}
