import { useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, XCircle, Loader2, X } from 'lucide-react';
import { fileApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { fmtBytes } from './ui.jsx';

const LABEL = { original: 'Original Client Artwork', revised: 'Revised Designer Artwork' };
const TONE = { original: 'border-red-200 bg-red-50/40', revised: 'border-green-200 bg-green-50/40' };
const DOT = { original: 'bg-red-500', revised: 'bg-green-600' };

/**
 * One upload slot. Validation happens server-side (content signature, encryption, page count, text layer);
 * this component only shows genuine state: uploading % -> validating -> validated | rejected.
 */
export default function UploadSlot({ role, projectId, value, existing = [], onChange, maxMb }) {
  const input = useRef(null);
  const [state, setState] = useState({ phase: 'idle', pct: 0, error: null, name: null, size: 0 });
  const [drag, setDrag] = useState(false);

  async function handle(file) {
    if (!file) return;
    if (maxMb && file.size > maxMb * 1048576) { setState({ phase: 'rejected', error: `File is ${fmtBytes(file.size)}; the limit is ${maxMb} MB.`, name: file.name, size: file.size }); return; }
    setState({ phase: 'uploading', pct: 0, error: null, name: file.name, size: file.size });
    try {
      const res = await fileApi.upload(projectId, role, file, (pct) => setState((s) => (pct >= 100 ? { ...s, phase: 'validating', pct } : { ...s, pct })));
      setState({ phase: 'idle', pct: 0, error: null }); onChange(res.data);
    } catch (e) { setState({ phase: 'rejected', error: toApiError(e).message, name: file.name, size: file.size }); onChange(null); }
  }
  const busy = state.phase === 'uploading' || state.phase === 'validating';

  return (
    <section aria-labelledby={`slot-${role}`} className={`rounded-lg border p-4 ${TONE[role]}`}>
      <h3 id={`slot-${role}`} className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${DOT[role]}`} aria-hidden />{LABEL[role]}</h3>
      {value ? (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{value.originalFilename}</p>
              <p className="text-xs text-slate-500">{fmtBytes(value.size)} · {value.pageCount} page{value.pageCount === 1 ? '' : 's'}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Uploaded and validated</p>
              {value.warnings?.map((w) => <p key={w.code} className="mt-1 flex gap-1 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{w.message}</p>)}
            </div>
            <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Remove ${value.originalFilename} from this comparison`} onClick={() => onChange(null)}><X className="h-4 w-4" /></button>
          </div>
        </div>
      ) : (
        <>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
            className={`flex flex-col items-center rounded-md border-2 border-dashed bg-white px-4 py-8 text-center ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}>
            {busy ? (<div className="w-full max-w-xs" role="status"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-brand-600" aria-hidden /><p className="truncate text-sm font-medium">{state.name}</p>
              <p className="text-xs text-slate-500">{state.phase === 'uploading' ? `Uploading… ${state.pct}%` : 'Validating PDF…'}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand-600 transition-all" style={{ width: `${state.phase === 'validating' ? 100 : state.pct}%` }} /></div></div>) : (<>
              <UploadCloud className="mb-2 h-7 w-7 text-slate-400" aria-hidden />
              <p className="text-sm">Drag a PDF here or</p>
              <button type="button" className="btn-secondary mt-2" onClick={() => input.current?.click()}>Choose PDF</button>
              <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label={`Choose ${LABEL[role]} file`} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ''; }} />
              {maxMb && <p className="mt-2 text-xs text-slate-500">PDF only · up to {maxMb} MB</p>}</>)}
          </div>
          {state.phase === 'rejected' && <p role="alert" className="mt-2 flex gap-1 text-sm text-red-700"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><strong>{state.name}</strong> was rejected: {state.error}</span></p>}
          {existing.length > 0 && !busy && (
            <label className="mt-3 block text-xs text-slate-600">…or reuse a file already in this project
              <select className="input mt-1" value="" onChange={(e) => onChange(existing.find((f) => f.id === e.target.value) || null)}><option value="">Select an uploaded file</option>
                {existing.map((f) => <option key={f.id} value={f.id}>{f.originalFilename} ({f.pageCount} p)</option>)}</select></label>)}
        </>
      )}
    </section>
  );
}
