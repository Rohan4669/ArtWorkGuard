import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { comparisonApi } from '../api/endpoints.js';
import { useLoad } from '../hooks.js';
import PdfViewer from '../components/PdfViewer.jsx';
import { ChecksPanel, SummaryStats, TextChanges, VerdictCard, Warnings } from '../components/ComparisonParts.jsx';
import { useSystem } from '../context/SystemContext.jsx';
import { Alert, Badge, PageHeader, Spinner, fmtDate, isDone } from '../components/ui.jsx';

/** Full, printable report: every changed page pair with its text changes, plus the generated PDF. */
export default function ReportDetail() {
  const { id } = useParams(); const { limitations } = useSystem();
  const { data: job, loading, error } = useLoad(() => comparisonApi.get(id).then((r) => r.data), [id]);
  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Report not available">{error.message}</Alert>;
  if (!isDone(job.status) || !job.result) return <Alert tone="warning" title="This comparison has no report yet">Its status is “{job.status}”. <Link className="underline" to={`/comparisons/${id}`}>Back to the comparison</Link></Alert>;
  const res = job.result; const changed = res.pairs.filter((p) => p.status !== 'identical');
  return (
    <>
      <PageHeader title="Detailed comparison report" subtitle={`${job.project?.name} · generated ${fmtDate(job.completedAt)}`}
        actions={<><Link className="btn-secondary" to={`/comparisons/${id}`}><ArrowLeft className="h-4 w-4" aria-hidden />Results</Link><button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print</button>
          {job.hasReport && <a className="btn-primary" href={comparisonApi.reportUrl(id)}><Download className="h-4 w-4" aria-hidden />Download PDF</a>}</>} />
      <div className="space-y-6">
        <VerdictCard job={job} /><Warnings warnings={job.warnings} /><SummaryStats summary={res.summary} pages={res.pages} />
        <section><h2 className="mb-2 text-lg font-semibold">Changes by page</h2>
          {changed.length === 0 ? <p className="text-sm text-slate-600">No page pair was flagged by the enabled checks.</p> : (
            <div className="space-y-4">{changed.map((p) => (
              <article key={p.pairIndex} className="card p-4 [break-inside:avoid]">
                <h3 className="mb-2 flex flex-wrap items-center gap-2 font-medium">Original page {p.originalPage ?? '–'} ↔ Revised page {p.revisedPage ?? '–'} <Badge tone={p.status === 'added' ? 'green' : p.status === 'removed' ? 'red' : 'amber'}>{p.status === 'added' ? 'Page added' : p.status === 'removed' ? 'Page removed' : 'Changed'}</Badge></h3>
                {p.status === 'changed' && <TextChanges changes={p.text.changes} />}
                {(p.status === 'added' || p.status === 'removed') && <p className="text-sm text-slate-600">{p.status === 'added' ? `${p.text.wordsAdded} words on the added page.` : `${p.text.wordsRemoved} words on the removed page.`}</p>}
                {p.visual.regions.length > 0 && <p className="mt-2 text-xs text-slate-500">{p.visual.regions.length} visual region(s) flagged.</p>}
                {!p.textAvailable.original || !p.textAvailable.revised ? <p className="mt-2 text-xs text-amber-800">Text could not be compared for this pair (no text layer on at least one side).</p> : null}
              </article>))}</div>)}</section>
        <section><h2 className="mb-2 text-lg font-semibold">Checks &amp; limitations</h2><ChecksPanel checks={res.checks} limitations={limitations} /></section>
        {job.hasReport && <section className="print:hidden"><h2 className="mb-2 text-lg font-semibold">Generated report (PDF)</h2><PdfViewer url={comparisonApi.reportUrl(id, true)} downloadUrl={comparisonApi.reportUrl(id)} title="Comparison report" height={700} /></section>}
      </div>
    </>
  );
}
