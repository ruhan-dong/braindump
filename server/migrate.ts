// Applies the SQL files in supabase/migrations/ to the database, in name order, each one only once.
//   npm run db:migrate
import "./env.ts";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const DIR = path.resolve("supabase/migrations");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: false });

try {
  // Which files have already run.
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table schema_migrations enable row level security`;
  await sql`revoke all on schema_migrations from anon, authenticated`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const name of files) {
    if (applied.has(name)) {
      console.log(`skip   ${name} (already applied)`);
      continue;
    }
    // One transaction per file: a file that fails leaves nothing behind.
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(DIR, name), "utf8"));
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    console.log(`apply  ${name}`);
  }
  console.log("Database is up to date.");
} finally {
  await sql.end();
}
