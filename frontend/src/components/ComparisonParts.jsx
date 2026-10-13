import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Crosshair, Maximize2, MinusCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { comparisonApi } from '../api/endpoints.js';
import { toApiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Badge, ReviewBadge, fmtDate } from './ui.jsx';
import ArtworkLightbox, { FocusBox } from './ArtworkLightbox.jsx';
import { buildItems, hasBox } from './artworkGeometry.js';

const PAIR = { identical: ['Identical', 'slate'], changed: ['Changed', 'amber'], added: ['Page added', 'green'], removed: ['Page removed', 'red'] };

export function VerdictCard({ job }) {
  const found = job.verdict === 'differences_found';
  return (
    <div className={`card border-l-4 p-4 ${found ? 'border-l-amber-500' : 'border-l-slate-400'}`}>
      <p className="font-semibold">{found ? 'Differences detected — manual review required' : 'No differences were detected by the checks that ran'}</p>
      <p className="mt-1 text-sm text-slate-600">{found ? 'Check every highlighted change against the client brief before release.' : 'This is not confirmation that the artwork is correct. Checks that were not performed are listed under “Checks & limits”.'}</p>
    </div>
  );
}

export function SummaryStats({ summary, pages }) {
  const items = [['Original pages', pages.original], ['Revised pages', pages.revised], ['Pages with changes', summary.pagesChanged], ['Pages added', summary.pagesAdded], ['Pages removed', summary.pagesRemoved], ['Text changes', summary.textChanges], ['Words added', summary.wordsAdded], ['Words removed', summary.wordsRemoved], ['Visual regions', summary.visualRegions]];
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items.map(([k, v]) => <div key={k} className="card p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>)}</dl>;
}

export function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return <Alert tone="warning" title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'} — results may be incomplete`}><ul className="list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></Alert>;
}

/**
 * List of text changes. When `onSelect` is given, each change that has a known position is clickable and
 * reports its index so the page view can highlight it on the artwork.
 */
export function TextChanges({ changes, selectedIndex = null, onSelect }) {
  if (!changes.length) return <p className="text-sm text-slate-500">No text changes detected on this page pair.</p>;
  const label = { replace: 'Changed', add: 'Added', delete: 'Deleted' };
  return (
    <ul className="space-y-2">{changes.map((c, i) => {
      const clickable = Boolean(onSelect && (c.originalBox || c.revisedBox)); const on = selectedIndex === i;
      const act = clickable ? { role: 'button', tabIndex: 0, 'aria-pressed': on, onClick: () => onSelect(i), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); } } } : {};
      return (
        <li key={i} {...act} className={`rounded-md border bg-white p-3 text-sm ${on ? 'border-brand-600 ring-2 ring-brand-500/40' : 'border-slate-200'} ${clickable ? 'cursor-pointer hover:border-brand-500 hover:bg-brand-50/40' : ''}`}>
          <div className="flex items-center justify-between gap-2"><Badge tone={c.type === 'add' ? 'green' : c.type === 'delete' ? 'red' : 'amber'}>{label[c.type]}</Badge>
            {clickable && <span className={`inline-flex items-center gap-1 text-xs ${on ? 'font-medium text-brand-700' : 'text-slate-400'}`}><Crosshair className="h-3.5 w-3.5" aria-hidden />{on ? 'Shown on artwork' : 'Show on artwork'}</span>}</div>
          {c.original && <p className="mt-2 break-words"><span className="mr-1 font-semibold text-red-700" aria-label="Original text">Original:</span><span className="rounded bg-red-50 px-1 text-red-900 line-through decoration-red-400">{c.original}</span></p>}
          {c.revised && <p className="mt-1 break-words"><span className="mr-1 font-semibold text-green-700" aria-label="Revised text">Revised:</span><span className="rounded bg-green-50 px-1 text-green-900">{c.revised}</span></p>}
        </li>);
    })}</ul>
  );
}

/** Compact, clickable list of pixel-difference regions (these catch changes that have no text, e.g. images, colours). */
function RegionList({ items, selectedId, onSelect }) {
  if (!items.length) return null;
  return (
    <div className="mt-4"><h4 className="mb-2 text-sm font-semibold">Visual regions flagged <span className="font-normal text-slate-500">({items.length})</span></h4>
      <ul className="flex flex-wrap gap-2">{items.map((it) => (
        <li key={it.id}><button type="button" aria-pressed={it.id === selectedId} onClick={() => onSelect(it.id)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${it.id === selectedId ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}><Crosshair className="h-3 w-3" aria-hidden />{it.label} · {it.detail}</button></li>))}</ul>
    </div>
  );
}

/**
 * Side-by-side page images (server-rendered, with differences boxed: red = original side, green = revised side).
 * Selecting a mistake (text change or visual region) frames it on BOTH images and scrolls/zooms to it;
 * clicking an image opens it full screen.
 */
export function PageComparison({ job }) {
  const pairs = job.result.pairs; const firstChanged = Math.max(0, pairs.findIndex((p) => p.status !== 'identical'));
  const [sel, setSel] = useState(firstChanged); const [zoom, setZoom] = useState(100); const [onlyChanged, setOnlyChanged] = useState(false);
  const [focusId, setFocusId] = useState(null); const [lightbox, setLightbox] = useState(null); // lightbox: 'original' | 'revised' | 'both' | null
  const figs = useRef({}); const wraps = useRef({}); const grid = useRef(null);
  const p = pairs[sel]; const shown = pairs.map((x, i) => [x, i]).filter(([x]) => !onlyChanged || x.status !== 'identical');
  const items = useMemo(() => buildItems(p), [p]); const focusItem = items.find((i) => i.id === focusId) || null;
  const urls = { original: p.visual.images?.original ? comparisonApi.pageImageUrl(job.id, p.pairIndex, 'original') : null, revised: p.visual.images?.revised ? comparisonApi.pageImageUrl(job.id, p.pairIndex, 'revised') : null };

  function pickPair(i) { setSel(i); setFocusId(null); setLightbox(null); }
  function focus(id) {
    const it = items.find((x) => x.id === id); if (!it || !hasBox(it)) return;
    setFocusId(id);
    const b = it.boxes.original || it.boxes.revised; // zoom so the mistake fills roughly 40% of the pane width
    setZoom(Math.min(400, Math.max(100, Math.round((40 / Math.max(b.w, 0.02) / 25)) * 25)));
    grid.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Centre the framed mistake inside each (scrollable) image pane once the new zoom has been laid out.
  useEffect(() => {
    if (!focusItem) return undefined;
    const raf = requestAnimationFrame(() => {
      for (const side of ['original', 'revised']) {
        const fig = figs.current[side], wrap = wraps.current[side], box = focusItem.boxes[side];
        if (!fig || !wrap || !box) continue;
        fig.scrollTo({ left: wrap.offsetLeft + (box.x + box.w / 2) * wrap.offsetWidth - fig.clientWidth / 2, top: wrap.offsetTop + (box.y + box.h / 2) * wrap.offsetHeight - fig.clientHeight / 2, behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusItem, zoom]);

  const textItems = items.filter((i) => i.kind === 'text'); const visualItems = items.filter((i) => i.kind === 'visual');
  const selectedTextIndex = focusItem?.kind === 'text' ? Number(focusItem.id.slice(1)) : null;
  const size = p.visual.widthPx && p.visual.heightPx ? { w: p.visual.widthPx, h: p.visual.heightPx } : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <div>
        <label className="mb-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />Only pages with changes</label>
        <ul className="max-h-[32rem] space-y-1 overflow-auto" aria-label="Page pairs">{shown.map(([x, i]) => { const [l, t] = PAIR[x.status]; return (
          <li key={i}><button onClick={() => pickPair(i)} aria-current={i === sel} className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${i === sel ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <span>{x.originalPage ?? '–'} ↔ {x.revisedPage ?? '–'}</span><Badge tone={t}>{l}</Badge></button></li>); })}</ul>
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Original page {p.originalPage ?? '–'} ↔ Revised page {p.revisedPage ?? '–'}</p>
          <div className="flex items-center gap-1 text-xs">
            <button className="btn-secondary !px-2 !py-1" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom((z) => Math.max(50, z - 25))}><ZoomOut className="h-4 w-4" /></button><span className="w-10 text-center tabular-nums">{zoom}%</span><button className="btn-secondary !px-2 !py-1" aria-label="Zoom in" disabled={zoom >= 600} onClick={() => setZoom((z) => Math.min(600, z + 25))}><ZoomIn className="h-4 w-4" /></button>
            <button className="btn-secondary !px-2 !py-1" disabled={!urls.original && !urls.revised} onClick={() => setLightbox('both')}><Maximize2 className="h-4 w-4" aria-hidden />Full screen</button></div>
        </div>
        {p.visual.pageSizeMismatch && <div className="mb-2"><Alert tone="warning">Page sizes differ between the two documents.</Alert></div>}
        {items.some(hasBox) && <p className="mb-2 text-xs text-slate-500">Click a change below to locate it on both images. Click an image to open it full screen.</p>}
        <div ref={grid} className="grid gap-3 md:grid-cols-2">
          {['original', 'revised'].map((side) => (
            <figure key={side} ref={(el) => { figs.current[side] = el; }} className="relative overflow-auto rounded-md border border-slate-200 bg-slate-100 p-2" style={{ maxHeight: '36rem' }}>
              <figcaption className={`mb-1 flex items-center justify-between text-xs font-medium ${side === 'original' ? 'text-red-700' : 'text-green-700'}`}><span>{side === 'original' ? 'ORIGINAL — differences in red' : 'REVISED — differences in green'}</span>
                {urls[side] && <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-200" onClick={() => setLightbox(side)}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Full screen</button>}</figcaption>
              {urls[side] ? (
                <div ref={(el) => { wraps.current[side] = el; }} className="relative cursor-zoom-in overflow-hidden bg-white" style={{ width: `${zoom}%`, maxWidth: 'none' }} onClick={() => setLightbox(side)}>
                  <img alt={`${side} page ${side === 'original' ? p.originalPage : p.revisedPage}`} src={urls[side]} className="block w-full" />
                  <FocusBox box={focusItem?.boxes[side]} scale={1} />
                </div>) : <p className="p-6 text-center text-sm text-slate-500">No page on this side</p>}
            </figure>))}
        </div>
        <div className="mt-4"><h4 className="mb-2 text-sm font-semibold">Text changes on this page pair</h4>
          {!p.textAvailable.original || !p.textAvailable.revised ? <Alert tone="warning">Text could not be compared here: at least one side has no text layer. Only the visual markers above apply.</Alert> : <TextChanges changes={p.text.changes} selectedIndex={selectedTextIndex} onSelect={(i) => focus(textItems[i].id)} />}
          <RegionList items={visualItems} selectedId={focusId} onSelect={focus} />
          {p.visual.regions.length > 0 && <p className="mt-3 text-xs text-slate-500">{p.visual.regions.length} visual region{p.visual.regions.length === 1 ? '' : 's'} flagged{p.visual.regions.some((r) => r.kind === 'subtle') ? ' (including subtle colour shifts)' : ''}.</p>}</div>
      </div>
      {lightbox && <ArtworkLightbox key={`${job.id}-${sel}`} urls={urls} items={items} focusId={focusId} onFocus={setFocusId} initialSide={lightbox} size={size} title={`Original page ${p.originalPage ?? '–'} ↔ Revised page ${p.revisedPage ?? '–'}`} onClose={() => setLightbox(null)} />}
    </div>
  );
}

export function ChecksPanel({ checks, limitations }) {
  const icon = { performed: <CheckCircle2 className="h-4 w-4 text-green-600" />, limited: <AlertTriangle className="h-4 w-4 text-amber-600" />, not_performed: <MinusCircle className="h-4 w-4 text-slate-400" /> };
  const lbl = { performed: 'Performed', limited: 'Limited', not_performed: 'Not performed' };
  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-slate-100">{checks.map((c) => <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-sm"><span className="mt-0.5">{icon[c.status]}</span><div><p><span className="font-medium">{c.name}</span> <span className="text-xs text-slate-500">— {lbl[c.status]}</span></p>{c.note && <p className="text-xs text-slate-500">{c.note}</p>}</div></li>)}</ul>
      {limitations?.length > 0 && <Alert title="Limitations"><ul className="list-disc pl-4">{limitations.map((l) => <li key={l}>{l}</li>)}</ul></Alert>}
    </div>
  );
}

export function ReviewPanel({ job, reviews, onSaved }) {
  const toast = useToast(); const [decision, setDecision] = useState('approved'); const [comments, setComments] = useState(''); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const hasWarn = job.warnings?.length > 0;
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await comparisonApi.addReview(job.id, { decision, comments, acknowledgeWarnings: ack }); toast.success('Review saved'); setComments(''); setAck(false); onSaved(); }
    catch (err) { toast.error(toApiError(err).message); } finally { setBusy(false); }
  }
  const opts = [['approved', 'Accept — I have reviewed the differences'], ['changes_requested', 'Request changes'], ['rejected', 'Reject'], ['comment', 'Comment only']];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="card space-y-3 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Reviewer decision</h3><ReviewBadge status={job.reviewStatus} /></div>
        <fieldset><legend className="sr-only">Decision</legend>{opts.map(([v, l]) => <label key={v} className="flex items-center gap-2 py-1 text-sm"><input type="radio" name="decision" checked={decision === v} onChange={() => setDecision(v)} />{l}</label>)}</fieldset>
        <div><label htmlFor="rc" className="label">Notes {['rejected', 'changes_requested'].includes(decision) && '(required)'}</label><textarea id="rc" rows={4} maxLength={4000} className="input" value={comments} onChange={(e) => setComments(e.target.value)} /></div>
        {decision === 'approved' && hasWarn && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have read the warnings on this comparison and verified the affected content manually.</label>}
        <p className="text-xs text-slate-500">Accepting records that a person reviewed this comparison. It does not certify that the artwork is error-free.</p>
        <button className="btn-primary" disabled={busy || (decision === 'approved' && hasWarn && !ack) || (['rejected', 'changes_requested'].includes(decision) && !comments.trim())}>{busy ? 'Saving…' : 'Save review'}</button></form>
      <div><h3 className="mb-2 font-semibold">Review history</h3>{reviews.length === 0 ? <p className="text-sm text-slate-500">No reviews recorded yet.</p> : <ul className="space-y-2">{reviews.map((r) => <li key={r.id} className="card p-3 text-sm"><div className="flex items-center justify-between">{r.decision === 'comment' ? <Badge>Comment</Badge> : <ReviewBadge status={r.decision} />}<span className="text-xs text-slate-500">{fmtDate(r.createdAt)}</span></div><p className="mt-1 text-xs text-slate-500">{r.reviewerName}{r.decision === 'comment' ? ' · comment' : ''}</p>{r.comments && <p className="mt-1 whitespace-pre-wrap">{r.comments}</p>}</li>)}</ul>}</div>
    </div>
  );
}