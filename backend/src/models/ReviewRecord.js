import mongoose from 'mongoose';
const { Schema } = mongoose;
const reviewSchema = new Schema({
  job: { type: Schema.Types.ObjectId, ref: 'ComparisonJob', required: true, index: true },
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerName: { type: String },
  decision: { type: String, enum: ['approved', 'rejected', 'changes_requested', 'comment'], required: true },
  comments: { type: String, trim: true, maxlength: 4000, default: '' },
}, { timestamps: true });
reviewSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });
export const ReviewRecord = mongoose.model('ReviewRecord', reviewSchema);
