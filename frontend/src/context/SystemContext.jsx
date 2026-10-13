import { createContext, useContext, useEffect, useState } from 'react';
import { systemApi } from '../api/endpoints.js';

const FALLBACK = { appName: 'ArtworkGuard', registrationOpen: true, maxUploadMb: 50, maxPages: 100, engine: null, limitations: [] };
const Ctx = createContext(FALLBACK);
// eslint-disable-next-line react-refresh/only-export-components
export const useSystem = () => useContext(Ctx);

export function SystemProvider({ children }) {
  const [info, setInfo] = useState(FALLBACK);
  useEffect(() => { systemApi.info().then((r) => { setInfo(r.data); document.title = r.data.appName; }).catch(() => {}); }, []);
  return <Ctx.Provider value={info}>{children}</Ctx.Provider>;
}
