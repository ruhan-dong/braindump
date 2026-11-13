/** The largest file a message can carry. The storage bucket enforces the same limit (supabase/migrations/0002_storage.sql). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
