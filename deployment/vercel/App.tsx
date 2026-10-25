import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, LoaderCircle, LockKeyhole, LogOut, ShieldCheck, X } from "lucide-react";
import SecondLook from "../../components/second-look";

type Session = { canManage: boolean; loginAvailable: boolean; publicDemo?: boolean };
const PUBLIC_SESSION: Session = { canManage: false, loginAvailable: false, publicDemo: false };

export default function App() {
  const [session, setSession] = useState<Session>(PUBLIC_SESSION);
  const [ready, setReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const loginButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { cache: "no-store" })
      .then(response => response.ok ? response.json() : PUBLIC_SESSION)
      .then(value => { const next = value as Partial<Session> | null; if (!cancelled) setSession({ canManage: next?.canManage === true, loginAvailable: next?.loginAvailable === true, publicDemo: next?.publicDemo === true }); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loginOpen) return;
    passwordRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setLoginOpen(false);
      if (event.key === "Tab") {
        const controls = document.querySelector(".vercel-login-dialog")?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKey); loginButtonRef.current?.focus(); };
  }, [loginOpen, busy]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error("Unable to sign in. Check the demo password and try again.");
      const next = await response.json() as Session;
      if (!next.canManage) throw new Error("Unable to sign in. Please try again.");
      setSession({ canManage: true, loginAvailable: next.loginAvailable !== false, publicDemo: next.publicDemo === true }); setPassword(""); setLoginOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to sign in. Please try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (session.publicDemo) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      setSession(previous => ({ ...previous, canManage: false }));
    } catch { setError("Unable to sign out. Please try again."); }
    finally { setBusy(false); }
  }

  return <>
    <aside className="vercel-demo-banner" aria-label="Demo access">
      <div className="vercel-demo-banner-inner">
        <div className="vercel-demo-message"><span className="vercel-demo-icon">{session.canManage && !session.publicDemo ? <ShieldCheck size={20} /> : <Eye size={20} />}</span><p><strong>{session.publicDemo ? "Shared live demo" : session.canManage ? "Managing the demo" : "Public demo"}</strong><span>{session.publicDemo ? "Create scouts, run checks, and explore finds. Changes are shared with everyone using this demo." : session.canManage ? "Changes affect this shared workspace. Scouts keep running when you leave." : "Explore the shared scouts and their real finds. Management is reserved for the team."}</span></p></div>
        {!session.publicDemo && (session.canManage ? <button className="button button-secondary" disabled={busy} onClick={signOut}><LogOut size={16} />{busy ? "Signing out…" : "Leave management"}</button> : session.loginAvailable && <button className="button button-secondary" ref={loginButtonRef} onClick={() => { setError(""); setLoginOpen(true); }}><LockKeyhole size={16} />Manage demo</button>)}
      </div>
      {error && !loginOpen && <p className="vercel-access-error" role="alert">{error}</p>}
    </aside>
    {ready ? <SecondLook key={session.canManage ? "manager" : "visitor"} canManage={session.canManage} publicDemo /> : <main className="vercel-session-loading" aria-live="polite"><LoaderCircle size={24} className="spin" /><p>Opening Second Look…</p></main>}
    {loginOpen && !session.publicDemo && <div className="vercel-login-layer"><button className="vercel-login-backdrop" aria-label="Close management sign in" disabled={busy} onClick={() => setLoginOpen(false)} /><section className="vercel-login-dialog" role="dialog" aria-modal="true" aria-labelledby="vercel-login-title"><button className="icon-button vercel-login-close" aria-label="Close management sign in" disabled={busy} onClick={() => setLoginOpen(false)}><X size={22} /></button><span className="vercel-login-mark"><LockKeyhole size={24} /></span><h2 id="vercel-login-title">Manage the demo.</h2><p>Enter the team’s demo password to create scouts, run checks, and manage the shared finds.</p><form onSubmit={signIn}><label className="form-field"><span>Demo password</span><div className="input-with-icon"><LockKeyhole size={17} /><input ref={passwordRef} type="password" autoComplete="current-password" required maxLength={256} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></div></label>{error && <p className="vercel-login-error" role="alert">{error}</p>}<button type="submit" className="button button-primary" disabled={busy}>{busy ? <><LoaderCircle size={18} className="spin" />Signing in…</> : "Continue to management"}</button></form><small>This is a shared demo workspace. It does not create a personal account.</small></section></div>}
  </>;
}
