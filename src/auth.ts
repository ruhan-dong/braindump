// Sign-in, through Supabase Auth. The session is kept in cookies, so every request to our own server carries it
// and the server can tell who is asking (server/auth.ts).
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Reads a value out of the page's address and removes it from there. */
function takeFromAddress(name: string): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  url.searchParams.delete(name);
  history.replaceState(history.state, "", url);
  return value;
}

// The links in our emails open the app with ?token_hash=…&type=… in the address (the README has the templates).
// "email" confirms a new account and signs the person in. "recovery" lets them choose a new password. Either works in
// any browser, not only the one the email was asked for in.
const linkToken = takeFromAddress("token_hash");
const linkType = linkToken && takeFromAddress("type");
let confirmToken = linkType === "email" ? linkToken : null;
let resetToken = linkType === "recovery" ? linkToken : null;
// The reset link works once. If the new password is then turned down, the next try must not present the link again.
let resetVerified = false;

/** What the sign-in page should say about the link that brought the person here, if anything. */
let signInNote: string | null = null;

let client: Promise<SupabaseClient> | undefined;
/** The project's address and public key come from our server, so they are set in one place: its .env. */
const supabase = () =>
  (client ??= fetch("/api/status")
    .then((r) => r.json())
    .then(async (s) => {
      const made = createBrowserClient(s.supabaseUrl, s.supabaseKey, { cookieOptions: { secure: location.protocol === "https:" } });
      // Confirming comes first, so the person is already signed in when anyone asks who they are.
      if (confirmToken) {
        const { error } = await made.auth.verifyOtp({ token_hash: confirmToken, type: "email" });
        if (error) signInNote = "That link has expired or was already used. Sign in to continue.";
        confirmToken = null;
      }
      return made;
    }));

export const auth = {
  /** Calls back with the signed-in user's email (null when signed out): once right away, then on every change. */
  onChange(callback: (email: string | null) => void): () => void {
    let stop = () => {};
    let stopped = false;
    supabase().then((s) => {
      const { data } = s.auth.onAuthStateChange((_event, session) => {
        // Confirmation emails sent with Supabase's own template link through Supabase and come back with ?code=… in
        // the address. Supabase signs the person in with it and removes it, but only in the browser they signed up
        // in. Anywhere else the code is left over: the email is confirmed, and they still have to sign in.
        // Supabase has finished with the address by the time it first calls this.
        if (takeFromAddress("code") !== null) signInNote = "Email confirmed. Sign in to continue.";
        if (session) signInNote = null;
        callback(session?.user.email ?? null);
      });
      stop = () => data.subscription.unsubscribe();
      if (stopped) stop();
    });
    return () => {
      stopped = true;
      stop();
    };
  },

  /** Set when the page was opened from an emailed link and the person still has to sign in. */
  signInNote: () => signInNote,

  /** True when the page was opened from the link in the reset email, until a new password is set. */
  resetPending: () => resetToken !== null,

  /** Emails a link for choosing a new password. Returns what went wrong, or null when the request went through. */
  async requestReset(email: string): Promise<string | null> {
    const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    return error?.message ?? null;
  },

  /** Sets the password of whoever the reset link belongs to and signs them in. Returns what went wrong, or null. */
  async resetPassword(password: string): Promise<string | null> {
    const s = await supabase();
    if (resetToken && !resetVerified) {
      const { error } = await s.auth.verifyOtp({ token_hash: resetToken, type: "recovery" });
      if (error) return error.code === "otp_expired" ? "This link has expired or was already used. Ask for a new one." : error.message;
      resetVerified = true;
    }
    const { error } = await s.auth.updateUser({ password });
    if (error) return error.message;
    resetToken = null;
    return null;
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
