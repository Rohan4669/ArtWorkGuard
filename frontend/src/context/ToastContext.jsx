import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

const Ctx = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx);
const ICON = { success: CheckCircle2, error: XCircle, warning: AlertTriangle };
const TONE = { success: 'border-green-200 bg-green-50 text-green-900', error: 'border-red-200 bg-red-50 text-red-900', warning: 'border-amber-200 bg-amber-50 text-amber-900' };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const dismiss = useCallback((i) => setItems((x) => x.filter((t) => t.id !== i)), []);
  const push = useCallback((type, message) => {
    const i = ++id.current; setItems((x) => [...x, { id: i, type, message }]); setTimeout(() => dismiss(i), type === 'error' ? 8000 : 4500);
  }, [dismiss]);
  const api = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), warning: (m) => push('warning', m) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => { const I = ICON[t.type]; return (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow ${TONE[t.type]}`}>
            <I className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{t.message}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
          </div>); })}
      </div>
    </Ctx.Provider>
  );
}
