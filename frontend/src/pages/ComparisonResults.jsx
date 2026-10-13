import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, FileText, RotateCcw, Trash2, ScrollText } from 'lucide-react';
import { comparisonApi, fileApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useLoad } from '../hooks.js';
import { useSystem } from '../context/SystemContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { ChecksPanel, PageComparison, ReviewPanel, SummaryStats, VerdictCard, Warnings } from '../components/ComparisonParts.jsx';
import { Alert, PageHeader, ReviewBadge, Spinner, StatusBadge, VerdictBadge, fmtBytes, fmtDate, fmtDuration, isActive, isDone } from '../components/ui.jsx';

const TABS = [['pages', 'Page comparison'], ['report', 'Report preview'], ['sources', 'Source files'], ['checks', 'Checks & limits'], ['review', 'Review']];

export default function ComparisonResults() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { limitations } = useSystem();
  const [tab, setTab] = useState('pages'); const [src, setSrc] = useState('original');
  const { data: job, loading, error, reload } = useLoad(() => comparisonApi.get(id).then((r) => r.data), [id]);
  const reviews = useLoad(() => comparisonApi.reviews(id).then((r) => r.data), [id]);
  useEffect(() => { if (job && isActive(job.status)) nav(`/comparisons/${id}/progress`, { replace: true }); }, [job, id, nav]);

  if (loading) return <Spinner label="Loading results…" />;
  if (error) return <Alert tone="error" title="Comparison not available">{error.message} <Link className="underline" to="/comparisons">Back to history</Link></Alert>;
  const done = isDone(job.status);
  async function retry() { try { await comparisonApi.retry(id); nav(`/comparisons/${id}/progress`); } catch (e) { toast.error(toApiError(e).message); } }
  async function remove() { if (!window.confirm('Delete this comparison and its report? The uploaded files are kept.')) return; try { await comparisonApi.remove(id); toast.success('Comparison deleted'); nav('/comparisons'); } catch (e) { toast.error(toApiError(e).message); } }
  const o = job.originalFile, r = job.revisedFile;

  return (
    <>
      <PageHeader title={job.project?.name || 'Comparison'} subtitle={[job.project?.clientName, job.project?.productName, job.project?.reference].filter(Boolean).join(' · ')}
        actions={<>
          {done && job.hasReport && <a className="btn-primary" href={comparisonApi.reportUrl(id)}><Download className="h-4 w-4" aria-hidden />Download report</a>}
          {done && <Link className="btn-secondary" to={`/comparisons/${id}/report`}><ScrollText className="h-4 w-4" aria-hidden />Detailed report</Link>}
          <button className="btn-secondary text-red-700" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden />Delete</button></>} />

      <div className="card mb-4 grid gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs font-medium uppercase text-red-700">Original Client Artwork</p><p className="truncate font-medium">{o?.originalFilename}</p><p className="text-xs text-slate-500">{o?.pageCount} pages · {o && fmtBytes(o.size)}</p></div>
        <div><p className="text-xs font-medium uppercase text-green-700">Revised Designer Artwork</p><p className="truncate font-medium">{r?.originalFilename}</p><p className="text-xs text-slate-500">{r?.pageCount} pages · {r && fmtBytes(r.size)}</p></div>
        <div><p className="text-xs text-slate-500">Status</p><div className="mt-1 flex flex-wrap gap-1"><StatusBadge status={job.status} /><VerdictBadge verdict={job.verdict} />{done && <ReviewBadge status={job.reviewStatus} />}</div></div>
        <div><p className="text-xs text-slate-500">Completed</p><p>{fmtDate(job.completedAt)}</p><p className="text-xs text-slate-500">{fmtDuration(job.startedAt, job.completedAt) && `Took ${fmtDuration(job.startedAt, job.completedAt)} · `}{job.engine?.id} v{job.engine?.version}</p></div>
      </div>

      {job.status === 'failed' && (<div className="space-y-3"><Alert tone="error" title={`Comparison failed${job.error?.code ? ` (${job.error.code})` : ''}`}>{job.error?.message}</Alert><button className="btn-primary" disabled={job.error?.code === 'INPUT_MISSING'} onClick={retry}><RotateCcw className="h-4 w-4" aria-hidden />Retry comparison</button></div>)}

      {done && job.result && (
        <div className="space-y-4">
          <VerdictCard job={job} /><Warnings warnings={job.warnings} /><SummaryStats summary={job.result.summary} pages={job.result.pages} />
          <div role="tablist" aria-label="Result sections" className="flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{l}{k === 'review' && job.reviewStatus === 'pending' ? ' •' : ''}</button>)}
          </div>
          <div role="tabpanel">
            {tab === 'pages' && <PageComparison job={job} />}
            {tab === 'report' && (job.hasReport ? <PdfViewer url={comparisonApi.reportUrl(id, true)} downloadUrl={comparisonApi.reportUrl(id)} title="Comparison report" height={680} /> : <Alert>No report is available for this comparison.</Alert>)}
            {tab === 'sources' && (<div className="space-y-3"><div className="flex gap-2">{[['original', o], ['revised', r]].map(([k]) => <button key={k} className={src === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setSrc(k)}><FileText className="h-4 w-4" aria-hidden />{k === 'original' ? 'Original' : 'Revised'}</button>)}</div>
              <PdfViewer key={src} url={fileApi.url((src === 'original' ? o : r).id, true)} downloadUrl={fileApi.url((src === 'original' ? o : r).id)} title={(src === 'original' ? o : r).originalFilename} height={640} /></div>)}
            {tab === 'checks' && <ChecksPanel checks={job.result.checks} limitations={limitations} />}
            {tab === 'review' && <ReviewPanel job={job} reviews={reviews.data || []} onSaved={() => { reload(true); reviews.reload(true); }} />}
          </div>
        </div>)}
    </>
  );
}
