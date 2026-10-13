import mongoose from 'mongoose';
import { notFound } from './errors.js';
/** Invalid ids are reported as 404 (not 400) so ids cannot be probed. */
export function parseId(v, what) {
  if (typeof v !== 'string' || !mongoose.isValidObjectId(v) || String(new mongoose.Types.ObjectId(v)) !== v) throw notFound(what);
  return v;
}
