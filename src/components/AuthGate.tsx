import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import App from "../App.tsx";
import { Landing } from "./Landing.tsx";

// The sign-in and sign-up pages each have their own address, so the back button, a reload or a shared link lands on them.
const PATHS = { in: "/signin", up: "/signup" } as const;

/** Shows the app to a signed-in user, and the landing page or sign-in page to everyone else. */
export function AuthGate() {
  // undefined: still finding out. null: signed out.
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);

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

  useEffect(
    () =>
      api.auth.onChange((next) => {
        const onAuthPage = location.pathname === PATHS.in || location.pathname === PATHS.up;
        // Signed in: the app lives at the home address. Back from the confirmation email: straight to sign-in.
        if (next !== null && onAuthPage) go("/", true);
        else if (next === null && api.auth.justConfirmed() && !onAuthPage) go(PATHS.in, true);
        setEmail(next);
      }),
    [],
  );

  if (email === undefined) return null;
  if (email === null) {
    const mode = path === PATHS.in ? "in" : path === PATHS.up ? "up" : null;
    if (!mode) return <Landing onSignIn={() => go(PATHS.in)} onSignUp={() => go(PATHS.up)} />;
    // Switching between the two forms replaces the history entry, so the back button always returns to the landing page.
    return <Login mode={mode} onSwitch={(m) => go(PATHS[m], true)} onBack={() => go("/")} />;
  }
  // The key makes the app start over when a different person signs in, so nothing of the last user's stays on screen.
  return <App key={email} email={email} />;
}

function Login({ mode, onSwitch, onBack }: { mode: "in" | "up"; onSwitch: (mode: "in" | "up") => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false); // the account was made; the emailed link has to be opened first

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirm(false);
    try {
      if (mode === "in") {
        setError(await api.auth.signIn(email.trim(), password));
      } else {
        const result = await api.auth.signUp(email.trim(), password);
        setError(result.error);
        setConfirm(result.confirm);
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
    setConfirm(false);
  }, [mode]);

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <button type="button" className="brand brand-link" onClick={onBack} title="Back to the home page">
          <span className="brand-mark">🧠</span>
          <span>BrainDump</span>
        </button>
        <h1>{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <p className="login-lede">{mode === "in" ? "Your notes are private to your account." : "Dump anything. It gets sorted for you."}</p>

        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error && <p className="dialog-error" role="alert">{error}</p>}
        {confirm && <p className="login-note" role="status">Almost there. Open the link we emailed to {email.trim()}, then sign in.</p>}
        {mode === "in" && !error && api.auth.justConfirmed() && <p className="login-note" role="status">Email confirmed. Sign in to continue.</p>}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <p className="login-switch">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <button type="button" onClick={() => onSwitch(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
