import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { comparisonApi, fileApi, projectApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useSystem } from '../context/SystemContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import UploadSlot from '../components/UploadSlot.jsx';
import { Alert, Field, PageHeader } from '../components/ui.jsx';

const EMPTY = { name: '', clientName: '', productName: '', reference: '', notes: '' };
const STEPS = ['Project', 'Original artwork', 'Revised artwork', 'Review & start'];

export default function NewComparison() {
  const nav = useNavigate(); const toast = useToast(); const sys = useSystem(); const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [projects, setProjects] = useState([]); const [mode, setMode] = useState('new');
  const [form, setForm] = useState(EMPTY); const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]); const [original, setOriginal] = useState(null); const [revised, setRevised] = useState(null);
  const [sensitivity, setSensitivity] = useState('standard'); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);

  useEffect(() => {
    projectApi.list({ status: 'active', limit: 100 }).then((r) => {
      setProjects(r.data); const pre = params.get('project');
      if (pre) { const p = r.data.find((x) => x.id === pre); if (p) { setProject(p); setMode('existing'); setStep(1); } }
      else if (r.data.length) setMode('existing');
    }).catch(() => {});
  }, [params]);
  useEffect(() => { if (project) fileApi.list(project.id).then((r) => setFiles(r.data)).catch(() => {}); }, [project]);

  async function confirmProject() {
    setBusy(true); setError(null);
    try {
      if (mode === 'new') { const r = await projectApi.create(form); setProject(r.data); setProjects((p) => [r.data, ...p]); setMode('existing'); }
      setStep(1);
    } catch (e) { setError(toApiError(e)); } finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await comparisonApi.create({ projectId: project.id, originalFileId: original.id, revisedFileId: revised.id, options: { sensitivity } });
      toast.success('Comparison queued'); nav(`/comparisons/${r.data.id}/progress`);
    } catch (e) { setError(toApiError(e)); setBusy(false); }
  }
  const warnings = [...(original?.warnings || []).map((w) => `Original: ${w.message}`), ...(revised?.warnings || []).map((w) => `Revised: ${w.message}`)];
  if (original && revised && original.sha256 === revised.sha256) warnings.push('The two files are byte-for-byte identical. The comparison will find no differences.');
  if (original && revised && original.pageCount !== revised.pageCount) warnings.push(`Page counts differ (${original.pageCount} vs ${revised.pageCount}). Pages will be aligned by content.`);

  return (
    <>
      <PageHeader title="New Artwork Comparison" subtitle="Compare the client's original PDF with the designer's revised PDF." />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Progress">
        {STEPS.map((s, i) => (<li key={s} aria-current={i === step ? 'step' : undefined} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i === step ? 'border-brand-600 bg-brand-50 text-brand-700' : i < step ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-500'}`}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold">{i < step ? <Check className="h-3 w-3" aria-hidden /> : i + 1}</span>{s}</li>))}
      </ol>
      {error && <div className="mb-4"><Alert tone="error">{error.message}</Alert></div>}

      {step === 0 && (
        <div className="card max-w-2xl p-5">
          {projects.length > 0 && <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Project source">
            {[['existing', 'Use an existing project'], ['new', 'Create a new project']].map(([k, l]) => <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode(k)}>{l}</button>)}</div>}
          {mode === 'existing' ? (
            <Field label="Project" id="proj"><select id="proj" className="input" value={project?.id || ''} onChange={(e) => setProject(projects.find((p) => p.id === e.target.value) || null)}><option value="">Select a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.clientName ? ` — ${p.clientName}` : ''}</option>)}</select></Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Project name *" id="pn"><input id="pn" required maxLength={150} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
              <Field label="Client / company" id="cn"><input id="cn" maxLength={150} className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></Field>
              <Field label="Product name" id="pr"><input id="pr" maxLength={150} className="input" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} /></Field>
              <Field label="Project reference" id="rf"><input id="rf" maxLength={80} className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Notes" id="nt"><textarea id="nt" rows={3} maxLength={4000} className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            </div>)}
          <div className="mt-5 flex justify-end"><button className="btn-primary" disabled={busy || (mode === 'new' ? !form.name.trim() : !project)} onClick={confirmProject}>Continue<ArrowRight className="h-4 w-4" aria-hidden /></button></div>
        </div>)}

      {step === 1 && <div className="max-w-2xl"><UploadSlot role="original" projectId={project.id} value={original} existing={files.filter((f) => f.role === 'original')} onChange={setOriginal} maxMb={sys.maxUploadMb} />
        <Nav back={() => setStep(0)} next={() => setStep(2)} disabled={!original} /></div>}
      {step === 2 && <div className="max-w-2xl"><UploadSlot role="revised" projectId={project.id} value={revised} existing={files.filter((f) => f.role === 'revised')} onChange={setRevised} maxMb={sys.maxUploadMb} />
        <Nav back={() => setStep(1)} next={() => setStep(3)} disabled={!revised} /></div>}

      {step === 3 && (
        <div className="max-w-3xl space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[['Original Client Artwork', original, 'border-red-200'], ['Revised Designer Artwork', revised, 'border-green-200']].map(([l, f, c]) => (
              <div key={l} className={`card border-l-4 p-4 ${c}`}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</p><p className="mt-1 truncate text-sm font-medium">{f.originalFilename}</p><p className="text-xs text-slate-500">{f.pageCount} page{f.pageCount === 1 ? '' : 's'} · {f.hasTextLayer ? 'text layer found' : 'no text layer'}</p></div>))}
          </div>
          {warnings.length > 0 && <Alert tone="warning" title="Before you start"><ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
          <div className="card p-4"><Field label="Visual detection sensitivity" id="sens" hint="High also reports faint tint shifts, at the cost of more noise on photographic artwork.">
            <select id="sens" className="input max-w-xs" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}><option value="standard">Standard</option><option value="high">High (detect subtle colour shifts)</option></select></Field></div>
          <Alert title="What this comparison does not check">Barcode correctness, spot/CMYK values, overprint, bleed and dielines, and font substitution are not verified. A result of “no differences” never means the artwork is error-free.</Alert>
          <div className="flex justify-between"><button className="btn-secondary" onClick={() => setStep(2)}>Back</button><button className="btn-primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start comparison'}</button></div>
        </div>)}
    </>
  );
}
function Nav({ back, next, disabled }) {
  return <div className="mt-4 flex justify-between"><button className="btn-secondary" onClick={back}>Back</button><button className="btn-primary" disabled={disabled} onClick={next}>Continue<ArrowRight className="h-4 w-4" aria-hidden /></button></div>;
}
