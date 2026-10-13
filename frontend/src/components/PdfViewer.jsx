import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, Download } from 'lucide-react';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// The worker must match the API's pdfjs-dist exactly; react-pdf pins the version and the repo dedupes to one copy.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/** PDF preview with page navigation and zoom. `url` must be an authenticated API URL (cookie is sent). */
export default function PdfViewer({ url, title, downloadUrl, height = 560 }) {
  const [pages, setPages] = useState(0); const [page, setPage] = useState(1); const [scale, setScale] = useState(1); const [err, setErr] = useState(null);
  const clamp = (n) => Math.min(Math.max(1, n), Math.max(1, pages));
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span className="truncate font-medium">{title}</span>
        <div className="flex items-center gap-1">
          <button className="btn-secondary !px-2 !py-1" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(clamp(page - 1))}><ChevronLeft className="h-4 w-4" /></button>
          <label className="flex items-center gap-1 text-xs text-slate-600"><span className="sr-only">Page</span>
            <input aria-label="Page number" className="w-12 rounded border border-slate-300 px-1 py-0.5 text-center" value={page} onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setPage(clamp(n)); }} /> / {pages || '–'}</label>
          <button className="btn-secondary !px-2 !py-1" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(clamp(page + 1))}><ChevronRight className="h-4 w-4" /></button>
          <span className="mx-1 h-4 w-px bg-slate-300" />
          <button className="btn-secondary !px-2 !py-1" aria-label="Zoom out" disabled={scale <= 0.5} onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}><ZoomOut className="h-4 w-4" /></button>
          <span className="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <button className="btn-secondary !px-2 !py-1" aria-label="Zoom in" disabled={scale >= 3} onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))}><ZoomIn className="h-4 w-4" /></button>
          {downloadUrl && <a className="btn-secondary !px-2 !py-1" aria-label="Download PDF" href={downloadUrl}><Download className="h-4 w-4" /></a>}
        </div>
      </div>
      <div className="overflow-auto bg-slate-200 p-3" style={{ height }}>
        {err ? <p role="alert" className="p-6 text-center text-sm text-red-700">{err}</p> : (
          <Document file={{ url, withCredentials: true }} loading={<div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading PDF…</div>}
            onLoadSuccess={({ numPages }) => { setPages(numPages); setPage(1); }} onLoadError={() => setErr('This PDF could not be displayed. You can still download it.')}>
            <div className="mx-auto w-fit shadow"><Page pageNumber={page} scale={scale} renderAnnotationLayer={false} /></div>
          </Document>)}
      </div>
    </div>
  );
}
