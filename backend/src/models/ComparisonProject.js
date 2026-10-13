import mongoose from 'mongoose';
const { Schema } = mongoose;
const projectSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  clientName: { type: String, trim: true, maxlength: 150, default: '' },
  productName: { type: String, trim: true, maxlength: 150, default: '' },
  reference: { type: String, trim: true, maxlength: 80, default: '' },
  notes: { type: String, trim: true, maxlength: 4000, default: '' },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true });
projectSchema.index({ owner: 1, status: 1, updatedAt: -1 });
projectSchema.index({ owner: 1, name: 'text', clientName: 'text', productName: 'text', reference: 'text' });
projectSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });
export const ComparisonProject = mongoose.model('ComparisonProject', projectSchema);
