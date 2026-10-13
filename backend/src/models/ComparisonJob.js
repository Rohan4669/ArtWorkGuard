import mongoose from 'mongoose';
const { Schema } = mongoose;

export const JOB_STATUS = ['queued', 'comparing', 'generating_report', 'completed', 'completed_with_warnings', 'failed'];

const jobSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'ComparisonProject', required: true, index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  originalFile: { type: Schema.Types.ObjectId, ref: 'ArtworkFile', required: true },
  revisedFile: { type: Schema.Types.ObjectId, ref: 'ArtworkFile', required: true },
  status: { type: String, enum: JOB_STATUS, default: 'queued' },
  attempts: { type: Number, default: 0 },
  engine: { id: String, version: String },
  options: { sensitivity: { type: String, enum: ['standard', 'high'], default: 'standard' } },
  verdict: { type: String, enum: ['differences_found', 'no_differences_detected', null], default: null },
  summary: { type: Schema.Types.Mixed },           // small counts for lists/dashboard
  result: { type: Schema.Types.Mixed, select: false }, // full engine result (pairs, text changes, regions)
  warnings: [{ _id: false, code: String, message: String, pairIndex: Number }],
  error: { code: String, message: String, retryable: Boolean },
  reportKey: { type: String, select: false },
  reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'changes_requested'], default: 'pending' },
  queuedAt: { type: Date, default: Date.now },
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true });
jobSchema.index({ owner: 1, createdAt: -1 });
jobSchema.index({ owner: 1, status: 1 });
jobSchema.index({ status: 1, queuedAt: 1 });
jobSchema.virtual('hasReport').get(function () { return Boolean(this.reportKey); });
jobSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; delete r.reportKey; delete r.id_; return r; } });
export const ComparisonJob = mongoose.model('ComparisonJob', jobSchema);
