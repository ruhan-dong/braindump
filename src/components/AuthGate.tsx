import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import App from "../App.tsx";
import { Landing } from "./Landing.tsx";

// The sign-in pages and the app each have their own address, so the back button, a reload or a shared link lands on
// them, and the app's address is not the landing page's.
const PATHS = { in: "/signin", up: "/signup", forgot: "/forgot", app: "/app" } as const;

/** Shows the app to a signed-in user, and the landing page or sign-in page to everyone else. */
export function AuthGate() {
  // undefined: still finding out. null: signed out.
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);
  // Opened from the link in the reset email: choosing the new password comes first, whoever is signed in here.
  const [resetting, setResetting] = useState(api.auth.resetPending);

  function go(to: string, replace = false) {
    if (replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    setPath(to);
  }

  useEffect(() => {
    const sync = () => setPath(location.pathname);
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    let signedIn = false;
    return api.auth.onChange((next) => {
      const at = location.pathname;
      const onAuthPage = at === PATHS.in || at === PATHS.up;
      // Signed out of the app: back to the landing page. Opened the app's address while signed out, or came from an
      // emailed link that could not sign them in: straight to sign-in.
      if (next === null && at === PATHS.app) go(signedIn ? "/" : PATHS.in, true);
      else if (next === null && api.auth.signInNote() && !onAuthPage) go(PATHS.in, true);
      signedIn = next !== null;
      setEmail(next);
    });
  }, []);

  // A signed-in user is always at the app's address, however they got here: signing in, a link, the back button.
  // The demo is a single page with no addresses of its own.
  useEffect(() => {
    if (email && path !== PATHS.app && !api.demo && !resetting) go(PATHS.app, true);
  }, [email, path, resetting]);

  if (email === undefined) return null;
  if (resetting) {
    const leave = (to: string) => {
      setResetting(false);
      go(to, true);
    };
    return <Login mode="reset" onSwitch={(m) => leave(PATHS[m])} onBack={() => leave("/")} onDone={() => setResetting(false)} />;
  }
  if (email === null) {
    const mode = path === PATHS.in ? "in" : path === PATHS.up ? "up" : path === PATHS.forgot ? "forgot" : null;
    if (!mode) return <Landing onSignIn={() => go(PATHS.in)} onSignUp={() => go(PATHS.up)} />;
    // Switching between the forms replaces the history entry, so the back button always returns to the landing page.
    return <Login mode={mode} onSwitch={(m) => go(PATHS[m], true)} onBack={() => go("/")} />;
  }
  // The key makes the app start over when a different person signs in, so nothing of the last user's stays on screen.
  return <App key={email} email={email} />;
}

type Mode = "in" | "up" | "forgot" | "reset";
type Page = Exclude<Mode, "reset">; // the forms a person can switch to; "reset" is only reached from the emailed link

// What each form says, and the other form it offers underneath.
const FORMS: Record<Mode, { title: string; lede: string; submit: string; ask: string; link: string; to: Page }> = {
  in: { title: "Sign in", lede: "Your notes are private to your account.", submit: "Sign in", ask: "New here? ", link: "Create an account", to: "up" },
  up: { title: "Create your account", lede: "Dump anything. It gets sorted for you.", submit: "Create account", ask: "Already have an account? ", link: "Sign in", to: "in" },
  forgot: { title: "Reset your password", lede: "We'll email you a link to choose a new one.", submit: "Send reset link", ask: "Remembered it? ", link: "Sign in", to: "in" },
  reset: { title: "Choose a new password", lede: "You'll be signed in once it's saved.", submit: "Save password", ask: "Link not working? ", link: "Send a new one", to: "forgot" },
};

function Login({ mode, onSwitch, onBack, onDone }: { mode: Mode; onSwitch: (mode: Page) => void; onBack: () => void; onDone?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // what to do next, once an email has been sent
  const form = FORMS[mode];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (mode === "in") {
        setError(await api.auth.signIn(email.trim(), password));
      } else if (mode === "up") {
        const result = await api.auth.signUp(email.trim(), password);
        setError(result.error);
        if (result.confirm) setNote(`Almost there. Open the link we emailed to ${email.trim()}, then sign in.`);
      } else if (mode === "forgot") {
        const failed = await api.auth.requestReset(email.trim());
        setError(failed);
        // Said the same way whether or not the address has an account, so the form can't be used to find out.
        if (!failed) setNote(`If ${email.trim()} has an account, a link to choose a new password is on its way.`);
      } else {
        const failed = await api.auth.resetPassword(password);
        setError(failed);
        if (!failed) onDone?.();
      }
    } catch (err) {
      console.error(err);
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  // A message about one form doesn't belong on the other, however the switch happened (link or back button).
  useEffect(() => {
    setError(null);
    setNote(null);
  }, [mode]);

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <button type="button" className="brand brand-link" onClick={onBack} title="Back to the home page">
          <span className="brand-mark">🧠</span>
          <span>BrainDump</span>
        </button>
        <h1>{form.title}</h1>
        <p className="login-lede">{form.lede}</p>

        {mode !== "reset" && (
          <>
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </>
        )}
        {mode !== "forgot" && (
          <>
            <label htmlFor="login-password">{mode === "reset" ? "New password" : "Password"}</label>
            <input
              id="login-password"
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              required
              minLength={6}
              autoFocus={mode === "reset"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </>
        )}
        {mode === "in" && (
          <p className="login-forgot">
            <button type="button" onClick={() => onSwitch("forgot")}>Forgot password?</button>
          </p>
        )}

        {error && <p className="dialog-error" role="alert">{error}</p>}
        {note && <p className="login-note" role="status">{note}</p>}
        {mode === "in" && !error && api.auth.signInNote() && <p className="login-note" role="status">{api.auth.signInNote()}</p>}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "One moment…" : form.submit}
        </button>

        <p className="login-switch">
          {form.ask}
          <button type="button" onClick={() => onSwitch(form.to)}>{form.link}</button>
        </p>
      </form>
    </div>
  );
}
