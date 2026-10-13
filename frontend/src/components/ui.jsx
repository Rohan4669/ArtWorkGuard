/* eslint-disable react-refresh/only-export-components */
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle, Info, FileSearch, ShieldAlert } from 'lucide-react';

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDuration = (a, b) => { if (!a || !b) return null; const s = Math.max(0, (new Date(b) - new Date(a)) / 1000); return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`; };

export const STATUS = {
  queued: { label: 'Queued', tone: 'slate', icon: Clock }, comparing: { label: 'Comparing', tone: 'blue', icon: Loader2, spin: true },
  generating_report: { label: 'Generating report', tone: 'blue', icon: Loader2, spin: true }, completed: { label: 'Completed', tone: 'green', icon: CheckCircle2 },
  completed_with_warnings: { label: 'Completed with warnings', tone: 'amber', icon: AlertTriangle }, failed: { label: 'Failed', tone: 'red', icon: XCircle },
};
export const isActive = (s) => ['queued', 'comparing', 'generating_report'].includes(s);
export const isDone = (s) => ['completed', 'completed_with_warnings'].includes(s);
const TONES = { slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', violet: 'bg-violet-50 text-violet-700' };

export function Badge({ tone = 'slate', children, icon: Icon, spin }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{Icon && <Icon className={`h-3 w-3 ${spin ? 'animate-spin' : ''}`} aria-hidden />}{children}</span>;
}
export function StatusBadge({ status }) { const s = STATUS[status] || STATUS.queued; return <Badge tone={s.tone} icon={s.icon} spin={s.spin}>{s.label}</Badge>; }

const REVIEW = { pending: ['Review pending', 'slate'], approved: ['Accepted by reviewer', 'green'], rejected: ['Rejected', 'red'], changes_requested: ['Changes requested', 'amber'] };
export function ReviewBadge({ status }) { const [l, t] = REVIEW[status] || REVIEW.pending; return <Badge tone={t}>{l}</Badge>; }
export function VerdictBadge({ verdict }) {
  if (!verdict) return null;
  return verdict === 'differences_found' ? <Badge tone="amber" icon={FileSearch}>Differences found</Badge> : <Badge tone="slate" icon={Info}>No differences detected</Badge>;
}

export function Spinner({ label = 'Loading…' }) { return <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{label}</div>; }

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = FileSearch, title, text, action }) {
  return <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><Icon className="mb-3 h-8 w-8 text-slate-400" aria-hidden /><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}{action && <div className="mt-4">{action}</div>}</div>;
}

const ALERT = { info: ['border-blue-200 bg-blue-50 text-blue-900', Info], warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle], error: ['border-red-200 bg-red-50 text-red-900', ShieldAlert], success: ['border-green-200 bg-green-50 text-green-900', CheckCircle2] };
export function Alert({ tone = 'info', title, children }) {
  const [cls, Icon] = ALERT[tone];
  return <div role={tone === 'error' ? 'alert' : undefined} className={`flex gap-2 rounded-md border p-3 text-sm ${cls}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><div>{title && <p className="font-medium">{title}</p>}<div>{children}</div></div></div>;
}

export function Field({ label, id, error, hint, children }) {
  return <div><label htmlFor={id} className="label">{label}</label>{children}{hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}{error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}</div>;
}

export function Stat({ label, value, tone = 'slate', icon: Icon, to }) {
  const inner = (<div className="card flex items-center gap-3 p-4 transition hover:border-slate-300"><div className={`rounded-md p-2 ${TONES[tone]}`}><Icon className="h-5 w-5" aria-hidden /></div><div><p className="text-2xl font-semibold leading-none">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div></div>);
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function Pagination({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return <div className="mt-4 flex items-center justify-between text-sm text-slate-600"><span>Page {page} of {pages} · {total} total</span><div className="flex gap-2"><button className="btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><button className="btn-secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div></div>;
}
