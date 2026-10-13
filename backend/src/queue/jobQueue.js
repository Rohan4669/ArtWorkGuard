import { ComparisonJob } from '../models/ComparisonJob.js';

/**
 * Minimal durable job queue. Job state lives in MongoDB (status "queued"), the in-memory list is only a wake-up
 * hint, so a crash/restart loses nothing: start() re-enqueues "queued" jobs and fails/requeues jobs that were
 * mid-flight. Jobs are claimed atomically (findOneAndUpdate) so a job can never run twice concurrently.
 * To scale out, replace this class with BullMQ/SQS behind the same enqueue()/start()/stop() surface.
 */
export class JobQueue {
  constructor({ concurrency, maxAttempts, handler, log }) {
    Object.assign(this, { concurrency, maxAttempts, handler, log });
    this.pending = []; this.running = new Set(); this.stopped = false; this.idleWaiters = [];
  }

  async start() {
    // Crash recovery: anything left mid-flight by a previous process is retried (attempts permitting).
    const stuck = await ComparisonJob.find({ status: { $in: ['comparing', 'generating_report'] } }).select('_id attempts');
    for (const j of stuck) {
      if (j.attempts >= this.maxAttempts) {
        await ComparisonJob.updateOne({ _id: j._id }, { status: 'failed', completedAt: new Date(), error: { code: 'INTERRUPTED', message: 'The server restarted while this comparison was running.', retryable: true } });
      } else await ComparisonJob.updateOne({ _id: j._id }, { status: 'queued' });
    }
    const queued = await ComparisonJob.find({ status: 'queued' }).sort({ queuedAt: 1 }).select('_id');
    queued.forEach((j) => this.enqueue(String(j._id)));
    this.log.info({ recovered: stuck.length, queued: queued.length }, 'job queue started');
  }

  enqueue(id) { if (!this.pending.includes(id) && !this.running.has(id)) { this.pending.push(id); setImmediate(() => this.#pump()); } }

  async #pump() {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      // Atomic claim: only one process/worker can flip queued -> comparing.
      const claim = await ComparisonJob.updateOne({ _id: id, status: 'queued' }, { status: 'comparing', startedAt: new Date(), $inc: { attempts: 1 }, $unset: { error: 1 } });
      if (claim.modifiedCount !== 1) continue; // already claimed / cancelled
      const job = await ComparisonJob.findById(id);
      if (!job) continue;
      this.running.add(id);
      Promise.resolve(this.handler(job)).catch((e) => this.log.error({ err: e?.message, id }, 'job handler threw'))
        .finally(() => { this.running.delete(id); this.#pump(); this.#notifyIdle(); });
    }
  }

  #notifyIdle() { if (!this.running.size && !this.pending.length) { this.idleWaiters.splice(0).forEach((r) => r()); } }
  onIdle() { return (!this.running.size && !this.pending.length) ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r)); }
  async stop() { this.stopped = true; await this.onIdle(); }
}
