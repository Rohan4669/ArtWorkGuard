import { LocalStorage } from './localStorage.js';

export async function createStorages(cfg) {
  const s = {
    uploads: new LocalStorage(cfg.UPLOAD_DIR),
    reports: new LocalStorage(cfg.REPORT_DIR),
    pages: new LocalStorage(cfg.PAGE_IMAGE_DIR),
    temp: new LocalStorage(cfg.TEMP_DIR),
  };
  await Promise.all(Object.values(s).map((x) => x.init()));
  return s;
}
