import { Link } from 'react-router-dom';
import { FilePlus2, GitCompare, CheckCircle2, ClipboardCheck, XCircle, Loader2, FolderOpen, FileText } from 'lucide-react';
import { dashboardApi } from '../api/endpoints.js';
import { useLoad } from '../hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, EmptyState, PageHeader, Spinner, Stat, StatusBadge, ReviewBadge, VerdictBadge, fmtDate, fmtBytes } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => dashboardApi.get().then((r) => r.data));
  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load the dashboard">{error.message} <button className="underline" onClick={() => reload()}>Retry</button></Alert>;
  const { stats, recentProjects, recentFiles, latestComparisons } = data;
  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Every completed comparison needs a human review before artwork goes to print."
        actions={<Link to="/comparisons/new" className="btn-primary"><FilePlus2 className="h-4 w-4" aria-hidden />New Artwork Comparison</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total comparisons" value={stats.total} icon={GitCompare} to="/comparisons" />
        <Stat label="Completed" value={stats.completed} icon={CheckCircle2} tone="green" to="/comparisons?status=completed,completed_with_warnings" />
        <Stat label="Awaiting review" value={stats.needReview} icon={ClipboardCheck} tone="amber" to="/comparisons?status=completed,completed_with_warnings&reviewStatus=pending" />
        <Stat label="Failed" value={stats.failed} icon={XCircle} tone="red" to="/comparisons?status=failed" />
        <Stat label="In progress" value={stats.inProgress} icon={Loader2} tone="blue" to="/comparisons?status=queued,comparing,generating_report" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="latest">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 id="latest" className="font-semibold">Latest comparison reports</h2><Link to="/comparisons" className="text-sm text-brand-700">View all</Link></div>
          {latestComparisons.length === 0 ? <div className="p-4"><EmptyState title="No comparisons yet" text="Upload an original and a revised PDF to run your first comparison." action={<Link to="/comparisons/new" className="btn-primary">Start a comparison</Link>} /></div> : (
            <ul className="divide-y divide-slate-100">{latestComparisons.map((c) => (
              <li key={c.id}><Link to={['queued', 'comparing', 'generating_report'].includes(c.status) ? `/comparisons/${c.id}/progress` : `/comparisons/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{c.project?.name}</p><p className="truncate text-xs text-slate-500">{c.originalFile?.originalFilename} → {c.revisedFile?.originalFilename}</p></div>
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /><VerdictBadge verdict={c.verdict} />{c.status.startsWith('completed') && <ReviewBadge status={c.reviewStatus} />}<span className="text-xs text-slate-500">{fmtDate(c.createdAt)}</span></div>
              </Link></li>))}</ul>)}
        </section>
        <div className="space-y-6">
          <section className="card" aria-labelledby="proj"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 id="proj" className="font-semibold">Recent projects</h2><Link to="/projects" className="text-sm text-brand-700">All</Link></div>
            {recentProjects.length === 0 ? <p className="p-4 text-sm text-slate-500">No projects yet.</p> : <ul className="divide-y divide-slate-100">{recentProjects.map((p) => <li key={p.id}><Link to={`/projects/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50"><FolderOpen className="h-4 w-4 text-slate-400" aria-hidden /><span className="truncate">{p.name}</span></Link></li>)}</ul>}</section>
          <section className="card" aria-labelledby="files"><div className="border-b border-slate-200 px-4 py-3"><h2 id="files" className="font-semibold">Recent uploaded documents</h2></div>
            {recentFiles.length === 0 ? <p className="p-4 text-sm text-slate-500">No uploads yet.</p> : <ul className="divide-y divide-slate-100">{recentFiles.map((f) => <li key={f.id} className="flex items-center gap-2 px-4 py-2.5 text-sm"><FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /><div className="min-w-0"><p className="truncate">{f.originalFilename}</p><p className="text-xs text-slate-500">{f.role === 'original' ? 'Original' : 'Revised'} · {fmtBytes(f.size)} · {fmtDate(f.createdAt)}</p></div></li>)}</ul>}</section>
        </div>
      </div>
    </>
  );
}
