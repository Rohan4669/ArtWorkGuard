import { useState } from 'react';
import { userApi, adminApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSystem } from '../context/SystemContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useLoad } from '../hooks.js';
import { Alert, Badge, Field, PageHeader, Spinner, fmtDate } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth(); const sys = useSystem(); const toast = useToast();
  const [name, setName] = useState(user.name); const [pw, setPw] = useState({ currentPassword: '', newPassword: '' }); const [busy, setBusy] = useState(false); const [pwErr, setPwErr] = useState(null);
  async function saveName(e) { e.preventDefault(); setBusy(true); try { const r = await userApi.update({ name }); setUser(r.data.user); toast.success('Profile updated'); } catch (err) { toast.error(toApiError(err).message); } finally { setBusy(false); } }
  async function savePw(e) {
    e.preventDefault(); setBusy(true); setPwErr(null);
    try { await userApi.changePassword(pw); setPw({ currentPassword: '', newPassword: '' }); toast.success('Password changed. Other sessions were signed out.'); } catch (err) { setPwErr(toApiError(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Profile & settings" subtitle={`${user.email} · ${user.role}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveName} className="card space-y-4 p-5"><h2 className="font-semibold">Profile</h2>
          <Field label="Full name" id="nm"><input id="nm" required maxLength={100} className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <button className="btn-primary" disabled={busy || !name.trim() || name === user.name}>Save</button></form>
        <form onSubmit={savePw} className="card space-y-4 p-5"><h2 className="font-semibold">Change password</h2>
          {pwErr && <Alert tone="error">{pwErr.message}{pwErr.details && <ul className="list-disc pl-4">{pwErr.details.map((d) => <li key={d.message}>{d.message}</li>)}</ul>}</Alert>}
          <Field label="Current password" id="cp"><input id="cp" type="password" autoComplete="current-password" required className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" id="np" hint="At least 10 characters with upper-case, lower-case and a number."><input id="np" type="password" autoComplete="new-password" required className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <button className="btn-primary" disabled={busy}>Change password</button></form>
        <section className="card space-y-2 p-5 lg:col-span-2" aria-labelledby="inst"><h2 id="inst" className="font-semibold">This installation</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Comparison engine</dt><dd>{sys.engine ? `${sys.engine.id} v${sys.engine.version}` : '—'}</dd></div><div><dt className="text-xs text-slate-500">Upload limit</dt><dd>{sys.maxUploadMb} MB</dd></div><div><dt className="text-xs text-slate-500">Page limit</dt><dd>{sys.maxPages} pages</dd></div><div><dt className="text-xs text-slate-500">Registration</dt><dd>{sys.registrationOpen ? 'Open' : 'Closed'}</dd></div></dl>
          <Alert title="Limitations"><ul className="list-disc pl-4">{sys.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Alert></section>
        {user.role === 'admin' && <AdminPanel />}
      </div>
    </>
  );
}

function AdminPanel() {
  const users = useLoad(() => adminApi.users().then((r) => r.data)); const audit = useLoad(() => adminApi.audit(30).then((r) => r.data));
  return (
    <>
      <section className="card p-5" aria-labelledby="usr"><h2 id="usr" className="mb-3 font-semibold">Users (admin)</h2>
        {users.loading ? <Spinner /> : <ul className="divide-y divide-slate-100 text-sm">{users.data?.map((u) => <li key={u.id} className="flex items-center justify-between py-2"><span className="truncate">{u.name} <span className="text-slate-500">{u.email}</span></span><Badge tone={u.role === 'admin' ? 'violet' : 'slate'}>{u.role}</Badge></li>)}</ul>}</section>
      <section className="card p-5" aria-labelledby="aud"><h2 id="aud" className="mb-3 font-semibold">Recent audit events (admin)</h2>
        {audit.loading ? <Spinner /> : <ul className="max-h-72 divide-y divide-slate-100 overflow-auto text-xs">{audit.data?.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1.5"><span><strong>{a.action}</strong> {a.actor?.name && `· ${a.actor.name}`}</span><span className="shrink-0 text-slate-500">{fmtDate(a.createdAt)}</span></li>)}</ul>}</section>
    </>
  );
}
