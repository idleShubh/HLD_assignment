// Batch writer — turns a burst of individual search submissions into a few
// aggregated database writes.
//
// Instead of one synchronous DB UPDATE per POST /search, increments land in an
// in-memory buffer keyed by query (so 50 searches for "iphone" become a single
// "+50"). The buffer is flushed on a timer OR once it reaches a size threshold.
// Each flush is one SQLite transaction.
//
// Trade-off (discussed in the README): the buffer lives only in memory, so a
// crash before a flush loses at most the last interval's increments. That's an
// acceptable loss for popularity counters; we'd add a write-ahead log if these
// counts had to be exact.

import { config } from './config.js';

export class BatchWriter {
  constructor({ onFlush }) {
    this.onFlush = onFlush; // (entries:[{query,delta,ts}]) => void
    this.buffer = new Map(); // query -> delta
    this.pendingOps = 0; // total increments buffered since last flush
    this.timer = null;

    // Lifetime metrics for the write-reduction evidence.
    this.totalSubmissions = 0; // individual searches received
    this.totalRowsWritten = 0; // distinct upserts actually sent to the DB
    this.totalFlushes = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush('timer'), config.batch.flushIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush('shutdown');
  }

  add(query) {
    this.totalSubmissions += 1;
    this.buffer.set(query, (this.buffer.get(query) || 0) + 1);
    this.pendingOps += 1;
    if (this.pendingOps >= config.batch.maxBufferOps) this.flush('size');
  }

  flush(reason = 'manual') {
    if (this.buffer.size === 0) return { rows: 0, reason };
    const ts = Date.now();
    const entries = [];
    for (const [query, delta] of this.buffer) entries.push({ query, delta, ts });
    this.buffer.clear();
    this.pendingOps = 0;

    this.onFlush(entries);

    this.totalRowsWritten += entries.length;
    this.totalFlushes += 1;
    return { rows: entries.length, reason };
  }

  metrics() {
    const saved = this.totalSubmissions - this.totalRowsWritten;
    return {
      totalSubmissions: this.totalSubmissions,
      totalRowsWritten: this.totalRowsWritten,
      totalFlushes: this.totalFlushes,
      writesSaved: saved,
      writeReductionPct: this.totalSubmissions
        ? +((saved / this.totalSubmissions) * 100).toFixed(2)
        : 0,
      bufferedNow: this.buffer.size
    };
  }
}
