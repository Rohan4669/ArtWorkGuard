import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { comparisonApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, PageHeader, StatusBadge, isDone } from '../components/ui.jsx';

const STEPS = [['queued', 'Queued'], ['comparing', 'Comparing pages'], ['generating_report', 'Generating report'], ['done', 'Completed']];
const ORDER = { queued: 0, comparing: 1, generating_report: 2, completed: 3, completed_with_warnings: 3, failed: -1 };

/** Polls the lightweight status endpoint. States shown are the server's real job states. */
export default function ComparisonProgress() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const [job, setJob] = useState(null); const [err, setErr] = useState(null); const [retrying, setRetrying] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let stop = false; let failures = 0;
    const tick = async () => {
      try {
        const r = await comparisonApi.status(id); if (stop) return; failures = 0; setJob(r.data); setErr(null);
        if (isDone(r.data.status)) { timer.current = setTimeout(() => nav(`/comparisons/${id}`, { replace: true }), 800); return; }
        if (r.data.status === 'failed') return;
      } catch (e) { failures++; if (e.response?.status === 404) { setErr(toApiError(e)); return; } if (failures > 5) { setErr(toApiError(e)); return; } }
      if (!stop) timer.current = setTimeout(tick, 1500);
    };
    tick(); return () => { stop = true; clearTimeout(timer.current); };
  }, [id, nav, retrying]);

  async function retry() {
    setRetrying(true);
    try { await comparisonApi.retry(id); setJob(null); toast.success('Comparison re-queued'); } catch (e) { toast.error(toApiError(e).message); } finally { setRetrying(false); }
  }
  if (err) return <Alert tone="error" title="Cannot track this comparison">{err.message} <Link className="underline" to="/comparisons">Back to history</Link></Alert>;
  const at = job ? ORDER[job.status] : 0; const failed = job?.status === 'failed';
  return (
    <>
      <PageHeader title="Comparison in progress" subtitle="This page updates automatically. You can leave it; the comparison keeps running." actions={job && <StatusBadge status={job.status} />} />
      <div className="card max-w-xl p-6">
        <ol className="space-y-4" aria-live="polite">
          {STEPS.map(([k, label], i) => {
            const state = failed ? (i < Math.max(at, 1) && i === 1 ? 'failed' : i === 0 ? 'done' : 'todo') : i < at ? 'done' : i === at ? (at === 3 ? 'done' : 'active') : 'todo';
            return (<li key={k} className="flex items-center gap-3 text-sm">
              {state === 'done' && <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />}{state === 'active' && <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />}
              {state === 'failed' && <XCircle className="h-5 w-5 text-red-600" aria-hidden />}{state === 'todo' && <Circle className="h-5 w-5 text-slate-300" aria-hidden />}
              <span className={state === 'todo' ? 'text-slate-400' : 'font-medium'}>{label}</span></li>);
          })}
        </ol>
        {failed && (
          <div className="mt-6 space-y-3"><Alert tone="error" title={`Comparison failed${job.error?.code ? ` (${job.error.code})` : ''}`}>{job.error?.message || 'The comparison could not be completed.'}</Alert>
            <div className="flex gap-2"><button className="btn-primary" disabled={retrying || job.error?.code === 'INPUT_MISSING'} onClick={retry}><RotateCcw className="h-4 w-4" aria-hidden />Retry</button><Link to="/comparisons/new" className="btn-secondary">Start over</Link></div></div>)}
        {job?.status === 'queued' && <p className="mt-4 text-xs text-slate-500">Waiting for a free worker…</p>}
        {isDone(job?.status) && <p className="mt-4 text-sm text-green-700">Done. Opening results…</p>}
      </div>
    </>
  );
}
