// Sign-in, through Supabase Auth. The session is kept in cookies, so every request to our own server carries it
// and the server can tell who is asking (server/auth.ts).
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: Promise<SupabaseClient> | undefined;
/** The project's address and public key come from our server, so they are set in one place: its .env. */
const supabase = () =>
  (client ??= fetch("/api/status")
    .then((r) => r.json())
    .then((s) => createBrowserClient(s.supabaseUrl, s.supabaseKey, { cookieOptions: { secure: location.protocol === "https:" } })));

export const auth = {
  /** Calls back with the signed-in user's email (null when signed out): once right away, then on every change. */
  onChange(callback: (email: string | null) => void): () => void {
    let stop = () => {};
    let stopped = false;
    supabase().then((s) => {
      const { data } = s.auth.onAuthStateChange((_event, session) => callback(session?.user.email ?? null));
      stop = () => data.subscription.unsubscribe();
      if (stopped) stop();
    });
    return () => {
      stopped = true;
      stop();
    };
  },

  /** Returns what went wrong, or null when signed in. */
  async signIn(email: string, password: string): Promise<string | null> {
    const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  },

  /** confirm: true means the account was made but the person must open the link emailed to them before signing in. */
  async signUp(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
    const s = await supabase();
    const { data, error } = await s.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
    if (error) return { error: error.message, confirm: false };
    // For an address that is already registered, Supabase answers as if it worked, with a user that has no identities.
    if (data.user?.identities?.length === 0) return { error: "An account with this email already exists. Sign in instead.", confirm: false };
    return { error: null, confirm: !data.session };
  },

  async signOut() {
    await (await supabase()).auth.signOut();
  },

  /** Forgets the session in this browser only. Used when the server no longer accepts it. */
  async forget() {
    await (await supabase()).auth.signOut({ scope: "local" });
  },
};
