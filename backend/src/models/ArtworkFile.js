import mongoose from 'mongoose';
const { Schema } = mongoose;
const fileSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'ComparisonProject', required: true, index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['original', 'revised'], required: true },
  originalFilename: { type: String, required: true, maxlength: 255 },
  storageKey: { type: String, required: true, unique: true, select: false }, // never sent to clients
  mimeType: { type: String, default: 'application/pdf' },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  pageCount: Number,
  pageSizes: [{ _id: false, width: Number, height: Number }],
  hasTextLayer: Boolean,
  textPages: Number,
  warnings: [{ _id: false, code: String, message: String }],
  uploadStatus: { type: String, enum: ['validated'], default: 'validated' }, // rejected files are never persisted
}, { timestamps: true });
fileSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; delete r.storageKey; return r; } });
export const ArtworkFile = mongoose.model('ArtworkFile', fileSchema);
