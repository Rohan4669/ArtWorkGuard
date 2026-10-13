import mongoose from 'mongoose';
const { Schema } = mongoose;
const auditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true, index: true },
  targetType: String,
  targetId: String,
  ip: String,
  meta: Schema.Types.Mixed, // ids/counts only - never document contents
}, { timestamps: { createdAt: true, updatedAt: false } });
auditSchema.index({ createdAt: -1 });
auditSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });
export const AuditLog = mongoose.model('AuditLog', auditSchema);
