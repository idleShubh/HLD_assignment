// Suggestion service — the brain that ties every piece together.
//
// Read path  (GET /suggest):  cache -> (miss) trie -> rank -> fill cache
// Write path (POST /search):  live count + live recency + buffered DB write
// Flush path (batch timer):   persist to SQLite -> refresh trie -> invalidate cache
//
// Two ranking modes share the same API, as the PRD requires:
//   - "count"   (basic, 60%): sort matching suggestions by all-time count
//   - "recency" (enhanced, 20%): blend popularity with decayed recent activity

import { initDb, loadAllRows, flushBatch, dbMetrics } from './db.js';
import { Trie, normalize } from './trie.js';
import { DistributedCache } from './distributedCache.js';
import { RecencyTracker } from './recency.js';
import { BatchWriter } from './batchWriter.js';
import { config } from './config.js';

export class SuggestionService {
  constructor() {
    this.trie = null;
    this.counts = new Map(); // normalized query -> live count (in-memory truth)
    this.cache = new DistributedCache();
    this.recency = new RecencyTracker();
    this.batch = new BatchWriter({ onFlush: (entries) => this._onFlush(entries) });
  }

  init() {
    initDb();
    const rows = loadAllRows();
    for (const r of rows) {
      const q = normalize(r.query);
      this.counts.set(q, r.count);
    }
    this.trie = Trie.build(rows);
    this.batch.start();
    return { loaded: rows.length };
  }

  // ---------------- read path ----------------
  suggest(rawPrefix, mode = 'count') {
    const prefix = normalize(rawPrefix);
    // Empty / missing input -> no suggestions (handled gracefully).
    if (!prefix) return { suggestions: [], source: 'empty', mode, node: null };

    const useMode = mode === 'recency' ? 'recency' : 'count';
    const key = DistributedCache.keyFor(useMode, prefix);
    const node = this.cache.nodeFor(key);

    const cached = this.cache.get(key);
    if (cached) return { suggestions: cached, source: 'cache', mode: useMode, node };

    // Cache miss -> compute from the trie candidate pool, then rank.
    const candidates = this.trie.getCandidates(prefix);
    let ranked;
    if (useMode === 'recency') {
      const now = Date.now();
      ranked = candidates
        .map((c) => {
          const recencyScore = this.recency.score(c.query, now);
          const score =
            config.ranking.wPopularity * Math.log10(c.count + 1) +
            config.ranking.wRecency * recencyScore;
          return { query: c.query, count: c.count, recencyScore: +recencyScore.toFixed(3), score: +score.toFixed(4) };
        })
        .sort((a, b) => b.score - a.score);
    } else {
      // Basic: already sorted by count desc in the trie pool.
      ranked = candidates.map((c) => ({ query: c.query, count: c.count }));
    }

    const suggestions = ranked.slice(0, config.maxSuggestions);
    this.cache.set(key, suggestions);
    return { suggestions, source: 'compute', mode: useMode, node };
  }

  // ---------------- write path ----------------
  submitSearch(rawQuery) {
    const query = normalize(rawQuery);
    if (!query) return { ok: false, error: 'empty query' };
    const now = Date.now();
    // Live in-memory count (so the next flush knows the new absolute total).
    this.counts.set(query, (this.counts.get(query) || 0) + 1);
    // Live recency (trending reflects this immediately, before any flush).
    this.recency.record(query, now);
    // Durable write is deferred to the batch writer.
    this.batch.add(query);
    return { ok: true, query, count: this.counts.get(query) };
  }

  // ---------------- flush path (batched) ----------------
  _onFlush(entries) {
    // 1) Persist aggregated deltas to SQLite in one transaction.
    flushBatch(entries);
    // 2) Refresh the trie + invalidate cache for the affected prefixes so
    //    suggestions and trending eventually reflect the new counts.
    for (const e of entries) {
      const newCount = this.counts.get(e.query);
      this.trie.update(e.query, newCount);
      this.cache.invalidatePrefixesOf(e.query);
    }
  }

  // ---------------- trending ----------------
  trending() {
    return this.recency.trending().map((t) => ({
      query: t.query,
      recencyScore: t.score,
      count: this.counts.get(t.query) || 0
    }));
  }

  // ---------------- debug / metrics ----------------
  cacheDebug(rawPrefix, mode = 'count') {
    const prefix = normalize(rawPrefix);
    const useMode = mode === 'recency' ? 'recency' : 'count';
    return { prefix, ...this.cache.inspect(useMode, prefix) };
  }

  metrics() {
    return {
      dataset: { uniqueQueries: this.counts.size, trieSize: this.trie?.size ?? 0 },
      cache: this.cache.metrics(),
      batch: this.batch.metrics(),
      db: dbMetrics(),
      ring: {
        nodes: this.cache.nodeIds,
        sampleDistribution: this._sampleRingDistribution()
      }
    };
  }

  // Spread of a sample of prefix keys across cache nodes (consistent-hashing
  // evidence for the report).
  _sampleRingDistribution() {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const keys = [];
    for (const a of letters)
      for (const b of letters) keys.push(DistributedCache.keyFor('count', a + b));
    return this.cache.ring.distribution(keys);
  }

  shutdown() {
    this.batch.stop();
  }
}
