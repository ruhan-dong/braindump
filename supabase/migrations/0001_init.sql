-- BrainDump tables. Every row belongs to one user (user_id).
-- Only the server reads these tables: it connects as their owner. Row level security is on with no policies, and the
-- Data API roles get no privileges, so a browser can never query them directly.

-- The raw log. Never rewritten by the AI: it is the source of truth.
create table messages (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id text not null default 'main',
  created_at bigint not null, -- milliseconds since 1970, as JavaScript's Date.now()
  text text not null default '',
  status text not null default 'pending' -- pending | done | error
);
create index messages_by_user on messages (user_id, conversation_id, created_at);

create table attachments (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null references messages (id) on delete cascade,
  position integer not null, -- order within the message
  kind text not null, -- image | video | audio | file
  filename text not null,
  mime text not null,
  size bigint not null,
  stored_name text not null,
  transcript text
);
create index attachments_by_message on attachments (message_id, position);

create table links (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null references messages (id) on delete cascade,
  position integer not null, -- order within the message
  url text not null,
  title text,
  description text,
  image text,
  site_name text
);
create index links_by_message on links (message_id, position);

-- Derived view of a message: what the organizer made of it.
create table items (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null references messages (id) on delete cascade,
  position integer not null,
  category text not null,
  topic text,
  title text not null,
  body text not null default '',
  attachment_id text references attachments (id) on delete cascade,
  link_id text references links (id) on delete cascade,
  done boolean not null default false
);
create index items_by_message on items (message_id, position);
create index items_by_user on items (user_id, category);

-- Custom templates: the user's prompt and the spec generated from it.
create table templates (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null,
  prompt text not null,
  spec jsonb not null
);
create index templates_by_user on templates (user_id, created_at);

-- Photo library: what the browser read from photos in folders the user gave access to. The originals stay in
-- those folders; only a thumbnail is stored.
create table photos (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  folder text not null, -- name of the granted folder
  path text not null, -- path inside that folder
  size bigint not null,
  modified_at bigint not null,
  taken_at bigint, -- from EXIF, when the photo has it
  lat double precision,
  lon double precision,
  text text not null default '', -- words read from the image (OCR)
  thumb_name text not null,
  indexed_at bigint not null,
  unique (user_id, folder, path)
);

-- "Find that screenshot…" messages: the photos found for them, best match first.
create table recalls (
  message_id text primary key references messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  terms jsonb not null, -- array of the words searched for
  photo_ids jsonb not null, -- array
  searched integer not null -- how many photos were searched
);

alter table messages enable row level security;
alter table attachments enable row level security;
alter table links enable row level security;
alter table items enable row level security;
alter table templates enable row level security;
alter table photos enable row level security;
alter table recalls enable row level security;

revoke all on messages, attachments, links, items, templates, photos, recalls from anon, authenticated;
