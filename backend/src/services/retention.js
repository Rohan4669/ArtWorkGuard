import { ComparisonJob } from '../models/ComparisonJob.js';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { ReviewRecord } from '../models/ReviewRecord.js';

/** Deletes comparisons (+reports, page images) and then orphaned uploads older than RETENTION_DAYS. Disabled when 0. */
export function createRetention({ cfg, storages, log }) {
  return {
    async purgeExpired(now = new Date()) {
      if (!cfg.RETENTION_DAYS) return { jobs: 0, files: 0 };
      const cutoff = new Date(now.getTime() - cfg.RETENTION_DAYS * 86400000);
      const jobs = await ComparisonJob.find({ createdAt: { $lt: cutoff }, status: { $in: ['completed', 'completed_with_warnings', 'failed'] } }).select('+reportKey');
      for (const j of jobs) {
        if (j.reportKey) await storages.reports.delete(j.reportKey);
        await storages.pages.deletePrefix(String(j._id)); await ReviewRecord.deleteMany({ job: j._id }); await j.deleteOne();
      }
      const old = await ArtworkFile.find({ createdAt: { $lt: cutoff } }).select('+storageKey');
      let files = 0;
      for (const f of old) {
        if (await ComparisonJob.exists({ $or: [{ originalFile: f._id }, { revisedFile: f._id }] })) continue;
        await storages.uploads.delete(f.storageKey); await f.deleteOne(); files++;
      }
      log.info({ jobs: jobs.length, files }, 'retention purge complete');
      return { jobs: jobs.length, files };
    },
  };
}
