import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSystem } from '../context/SystemContext.jsx';
import { toApiError } from '../api/client.js';
import { Alert, Field } from '../components/ui.jsx';

function Shell({ title, subtitle, children, footer }) {
  const { appName } = useSystem();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2"><ShieldCheck className="h-8 w-8 text-brand-700" aria-hidden /><span className="text-2xl font-semibold">{appName}</span></div>
        <div className="card p-6 sm:p-8"><h1 className="text-xl font-semibold">{title}</h1><p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>{children}</div>
        <p className="mt-4 text-center text-sm text-slate-600">{footer}</p>
      </div>
    </div>
  );
}

function useAuthForm(action) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const nav = useNavigate(); const loc = useLocation();
  const submit = async (e, body) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await action(body); nav(loc.state?.from || '/', { replace: true }); } catch (err) { setError(toApiError(err)); } finally { setBusy(false); }
  };
  return { busy, error, submit };
}
const fieldErr = (error, name) => error?.details?.find((d) => d.path === name)?.message;

export function LoginPage() {
  const { login } = useAuth(); const { registrationOpen } = useSystem();
  const [f, setF] = useState({ email: '', password: '' }); const { busy, error, submit } = useAuthForm(login);
  return (
    <Shell title="Sign in" subtitle="Compare client artwork against designer revisions." footer={registrationOpen && <>No account? <Link className="font-medium text-brand-700" to="/register">Create one</Link></>}>
      <form onSubmit={(e) => submit(e, f)} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error.message}</Alert>}
        <Field label="Email" id="email"><input id="email" type="email" autoComplete="email" required className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" id="password"><input id="password" type="password" autoComplete="current-password" required className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-center text-sm"><Link className="text-slate-600 hover:text-brand-700" to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const { register } = useAuth(); const { registrationOpen } = useSystem();
  const [f, setF] = useState({ name: '', email: '', password: '' }); const { busy, error, submit } = useAuthForm(register);
  if (!registrationOpen) return <Shell title="Registration closed" subtitle="Self-service sign-up is disabled on this installation." footer={<Link className="font-medium text-brand-700" to="/login">Back to sign in</Link>}><Alert>Ask an administrator to create an account for you.</Alert></Shell>;
  return (
    <Shell title="Create your account" subtitle="The first account created on a new installation becomes the administrator." footer={<>Already registered? <Link className="font-medium text-brand-700" to="/login">Sign in</Link></>}>
      <form onSubmit={(e) => submit(e, f)} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error.message}{error.details && <ul className="mt-1 list-disc pl-4">{error.details.map((d) => <li key={d.path + d.message}>{d.message}</li>)}</ul>}</Alert>}
        <Field label="Full name" id="name" error={fieldErr(error, 'name')}><input id="name" autoComplete="name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" id="email" error={fieldErr(error, 'email')}><input id="email" type="email" autoComplete="email" required className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" id="password" hint="At least 10 characters with upper-case, lower-case and a number." error={fieldErr(error, 'password')}><input id="password" type="password" autoComplete="new-password" required className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </Shell>
  );
}

/** Honest recovery page: email delivery is not configured in this build, so no fake "we sent you an email". */
export function ForgotPasswordPage() {
  return (
    <Shell title="Reset your password" subtitle="Self-service email recovery is not configured on this installation." footer={<Link className="font-medium text-brand-700" to="/login">Back to sign in</Link>}>
      <Alert title="Ask your administrator"><div className="flex gap-2"><Info className="hidden" />An administrator can set a new password from the server with <code className="rounded bg-white/60 px-1">npm run user:reset-password -w backend -- you@company.com</code>. If you are signed in on another device, you can also change your password in Profile &amp; settings.</div></Alert>
    </Shell>
  );
}
