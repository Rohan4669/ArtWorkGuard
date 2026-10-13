import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Download, Eye, FilePlus2, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { comparisonApi, fileApi, projectApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useLoad } from '../hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { Alert, EmptyState, Field, PageHeader, Pagination, Spinner, StatusBadge, VerdictBadge, fmtBytes, fmtDate } from '../components/ui.jsx';

export function ProjectsPage() {
  const toast = useToast(); const [search, setSearch] = useState(''); const [status, setStatus] = useState('active'); const [page, setPage] = useState(1);
  const [show, setShow] = useState(false); const [form, setForm] = useState({ name: '', clientName: '', productName: '', reference: '', notes: '' }); const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLoad(() => projectApi.list({ search: search || undefined, status, page, limit: 12 }), [search, status, page]);
  async function create(e) {
    e.preventDefault(); setBusy(true);
    try { await projectApi.create(form); toast.success('Project created'); setShow(false); setForm({ name: '', clientName: '', productName: '', reference: '', notes: '' }); reload(); }
    catch (err) { toast.error(toApiError(err).message); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Projects & files" subtitle="Each project holds the artwork files and comparisons for one job." actions={<button className="btn-primary" onClick={() => setShow((v) => !v)}><Plus className="h-4 w-4" aria-hidden />New project</button>} />
      {show && (
        <form onSubmit={create} className="card mb-6 grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Project name *" id="n"><input id="n" required maxLength={150} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
          <Field label="Client / company" id="c"><input id="c" className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></Field>
          <Field label="Product name" id="p"><input id="p" className="input" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} /></Field>
          <Field label="Reference" id="r"><input id="r" className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <Field label="Notes" id="no"><input id="no" className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setShow(false)}>Cancel</button><button className="btn-primary" disabled={busy || !form.name.trim()}>Create project</button></div>
        </form>)}
      <div className="mb-4 flex flex-wrap gap-2">
        <input aria-label="Search projects" className="input max-w-xs" placeholder="Search name, client, product, reference" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Project status" className="input w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="active">Active</option><option value="archived">Archived</option></select>
      </div>
      {loading ? <Spinner /> : error ? <Alert tone="error">{error.message}</Alert> : data.data.length === 0 ? <EmptyState icon={FolderOpen} title="No projects found" text="Create a project to start uploading artwork." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card block p-4 transition hover:border-brand-500"><h2 className="truncate font-semibold">{p.name}</h2><p className="truncate text-sm text-slate-500">{[p.clientName, p.productName].filter(Boolean).join(' · ') || 'No client or product set'}</p>
              <p className="mt-3 text-xs text-slate-500">{p.fileCount} file{p.fileCount === 1 ? '' : 's'} · {p.comparisonCount} comparison{p.comparisonCount === 1 ? '' : 's'} · updated {fmtDate(p.updatedAt)}</p></Link>))}</div>
          <Pagination page={page} total={data.meta.total} limit={data.meta.limit} onChange={setPage} />
        </>)}
    </>
  );
}

export function ProjectDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const [preview, setPreview] = useState(null);
  const proj = useLoad(() => projectApi.get(id).then((r) => r.data), [id]);
  const files = useLoad(() => fileApi.list(id).then((r) => r.data), [id]);
  const jobs = useLoad(() => comparisonApi.list({ projectId: id, limit: 50 }), [id]);
  if (proj.loading) return <Spinner />;
  if (proj.error) return <Alert tone="error" title="Project not available">{proj.error.message}</Alert>;
  const p = proj.data;
  async function toggleArchive() { try { await projectApi.update(id, { status: p.status === 'active' ? 'archived' : 'active' }); toast.success(p.status === 'active' ? 'Project archived' : 'Project restored'); proj.reload(); } catch (e) { toast.error(toApiError(e).message); } }
  async function remove() { if (!window.confirm('Delete this project and its uploaded files? This cannot be undone.')) return; try { await projectApi.remove(id); toast.success('Project deleted'); nav('/projects'); } catch (e) { toast.error(toApiError(e).message); } }
  async function removeFile(f) { if (!window.confirm(`Delete ${f.originalFilename}?`)) return; try { await fileApi.remove(f.id); toast.success('File deleted'); files.reload(); } catch (e) { toast.error(toApiError(e).message); } }
  return (
    <>
      <PageHeader title={p.name} subtitle={[p.clientName, p.productName, p.reference].filter(Boolean).join(' · ') || 'Project'}
        actions={<><Link className="btn-primary" to={`/comparisons/new?project=${p.id}`}><FilePlus2 className="h-4 w-4" aria-hidden />New comparison</Link>
          <button className="btn-secondary" onClick={toggleArchive}>{p.status === 'active' ? <><Archive className="h-4 w-4" aria-hidden />Archive</> : <><ArchiveRestore className="h-4 w-4" aria-hidden />Restore</>}</button>
          <button className="btn-secondary text-red-700" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden />Delete</button></>} />
      {p.notes && <p className="card mb-6 whitespace-pre-wrap p-4 text-sm text-slate-700">{p.notes}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card" aria-labelledby="pf"><h2 id="pf" className="border-b border-slate-200 px-4 py-3 font-semibold">Artwork files</h2>
          {files.loading ? <Spinner /> : !files.data?.length ? <p className="p-4 text-sm text-slate-500">No files uploaded to this project yet.</p> : (
            <ul className="divide-y divide-slate-100">{files.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{f.originalFilename}</p><p className="text-xs text-slate-500"><span className={f.role === 'original' ? 'text-red-700' : 'text-green-700'}>{f.role === 'original' ? 'Original' : 'Revised'}</span> · {fmtBytes(f.size)} · {f.pageCount} p · {fmtDate(f.createdAt)}</p></div>
                <div className="flex gap-1"><button className="btn-secondary !px-2" aria-label={`Preview ${f.originalFilename}`} onClick={() => setPreview(f)}><Eye className="h-4 w-4" /></button>
                  <a className="btn-secondary !px-2" aria-label={`Download ${f.originalFilename}`} href={fileApi.url(f.id)}><Download className="h-4 w-4" /></a>
                  <button className="btn-secondary !px-2 text-red-700" aria-label={`Delete ${f.originalFilename}`} onClick={() => removeFile(f)}><Trash2 className="h-4 w-4" /></button></div>
              </li>))}</ul>)}</section>
        <section className="card" aria-labelledby="pc"><h2 id="pc" className="border-b border-slate-200 px-4 py-3 font-semibold">Comparisons</h2>
          {jobs.loading ? <Spinner /> : !jobs.data?.data.length ? <p className="p-4 text-sm text-slate-500">No comparisons yet.</p> : (
            <ul className="divide-y divide-slate-100">{jobs.data.data.map((c) => <li key={c.id}><Link className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50" to={`/comparisons/${c.id}`}>
              <span className="truncate text-sm">{c.originalFile?.originalFilename} → {c.revisedFile?.originalFilename}</span><span className="flex gap-2"><StatusBadge status={c.status} /><VerdictBadge verdict={c.verdict} /></span></Link></li>)}</ul>)}</section>
      </div>
      {preview && <div className="mt-6"><div className="mb-2 flex justify-between"><h2 className="font-semibold">Preview</h2><button className="text-sm text-slate-600 underline" onClick={() => setPreview(null)}>Close preview</button></div><PdfViewer key={preview.id} url={fileApi.url(preview.id, true)} downloadUrl={fileApi.url(preview.id)} title={preview.originalFilename} /></div>}
    </>
  );
}
