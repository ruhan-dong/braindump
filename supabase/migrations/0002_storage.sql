-- Where uploaded files and photo thumbnails are kept: one private bucket, with each user's files under their own id
-- (<user id>/uploads/<name>, <user id>/thumbs/<name>).
-- The bucket has no access policies, so only the server (with the secret key) can read or write it. People get a file
-- through the server, which checks who they are and then hands out a short-lived link to that one file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800) -- 50 MB per file
on conflict (id) do nothing;
