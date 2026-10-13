import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FilePlus2, History, Trash2 } from 'lucide-react';
import { comparisonApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useLoad } from '../hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, EmptyState, PageHeader, Pagination, ReviewBadge, Spinner, StatusBadge, VerdictBadge, fmtDate, isActive, isDone } from '../components/ui.jsx';

const STATUS_FILTERS = [['', 'All statuses'], ['completed,completed_with_warnings', 'Completed'], ['completed_with_warnings', 'Completed with warnings'], ['failed', 'Failed'], ['queued,comparing,generating_report', 'In progress']];

export default function ComparisonHistory() {
  const toast = useToast(); const [sp, setSp] = useSearchParams(); const [page, setPage] = useState(1);
  const status = sp.get('status') || ''; const reviewStatus = sp.get('reviewStatus') || ''; const verdict = sp.get('verdict') || '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(1); };
  const { data, error, loading, reload } = useLoad(() => comparisonApi.list({ status: status || undefined, reviewStatus: reviewStatus || undefined, verdict: verdict || undefined, page, limit: 15 }), [status, reviewStatus, verdict, page]);
  async function remove(c) { if (!window.confirm('Delete this comparison and its report?')) return; try { await comparisonApi.remove(c.id); toast.success('Comparison deleted'); reload(true); } catch (e) { toast.error(toApiError(e).message); } }
  return (
    <>
      <PageHeader title="Comparison history" subtitle="All comparisons you have run." actions={<Link to="/comparisons/new" className="btn-primary"><FilePlus2 className="h-4 w-4" aria-hidden />New comparison</Link>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Status" className="input w-56" value={status} onChange={(e) => set('status', e.target.value)}>{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="Review status" className="input w-44" value={reviewStatus} onChange={(e) => set('reviewStatus', e.target.value)}><option value="">Any review state</option><option value="pending">Review pending</option><option value="approved">Accepted</option><option value="changes_requested">Changes requested</option><option value="rejected">Rejected</option></select>
        <select aria-label="Result" className="input w-48" value={verdict} onChange={(e) => set('verdict', e.target.value)}><option value="">Any result</option><option value="differences_found">Differences found</option><option value="no_differences_detected">No differences detected</option></select>
      </div>
      {loading ? <Spinner /> : error ? <Alert tone="error">{error.message}</Alert> : data.data.length === 0 ? <EmptyState icon={History} title="No comparisons match" text="Adjust the filters or start a new comparison." action={<Link to="/comparisons/new" className="btn-primary">New comparison</Link>} /> : (
        <>
          <div className="card overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><caption className="sr-only">Comparisons</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Project / files</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Result</th><th className="px-4 py-2">Review</th><th className="px-4 py-2">Created</th><th className="px-4 py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="max-w-xs px-4 py-3"><Link className="font-medium text-brand-700 hover:underline" to={isActive(c.status) ? `/comparisons/${c.id}/progress` : `/comparisons/${c.id}`}>{c.project?.name}</Link><p className="truncate text-xs text-slate-500">{c.originalFile?.originalFilename} → {c.revisedFile?.originalFilename}</p></td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td><td className="px-4 py-3"><VerdictBadge verdict={c.verdict} /></td>
                <td className="px-4 py-3">{isDone(c.status) && <ReviewBadge status={c.reviewStatus} />}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDate(c.createdAt)}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">{isDone(c.status) && c.hasReport && <a className="btn-secondary !px-2 !py-1" aria-label="Download report" href={comparisonApi.reportUrl(c.id)}><Download className="h-4 w-4" /></a>}
                  {!isActive(c.status) && <button className="btn-secondary !px-2 !py-1 text-red-700" aria-label="Delete comparison" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></button>}</div></td>
              </tr>))}</tbody></table></div>
          <Pagination page={page} total={data.meta.total} limit={data.meta.limit} onChange={setPage} />
        </>)}
    </>
  );
}
