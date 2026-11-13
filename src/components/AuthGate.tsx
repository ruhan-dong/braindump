import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import App from "../App.tsx";

/** Shows the app to a signed-in user, and the sign-in page to everyone else. */
export function AuthGate() {
  // undefined: still finding out. null: signed out.
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => api.auth.onChange(setEmail), []);

  if (email === undefined) return null;
  if (email === null) return <Login />;
  // The key makes the app start over when a different person signs in, so nothing of the last user's stays on screen.
  return <App key={email} email={email} />;
}

function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
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

  const switchTo = (next: "in" | "up") => {
    setMode(next);
    setError(null);
    setConfirm(false);
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">🧠</span>
          <span>BrainDump</span>
        </div>
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

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <p className="login-switch">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <button type="button" onClick={() => switchTo(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
