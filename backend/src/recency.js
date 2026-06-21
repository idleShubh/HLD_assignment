// Recency tracker — the engine behind trending searches and recency-aware
// ranking.
//
// Each query keeps a single time-decayed score. On every search we decay the
// old score by how much time has passed, then add 1. Decay uses a half-life:
// after `halfLifeMs` a past search counts for half as much. This answers the
// PRD's requirements directly:
//   - "how recent searches are tracked"  -> per-query decayed counter
//   - "how recent activity affects ranking" -> recencyScore() feeds the blend
//   - "avoid permanently over-ranking a short spike" -> the score decays to ~0
//     once the burst stops, so yesterday's viral query fades on its own.
// We update this live (not batched) so trending feels real-time even though
// count persistence is batched.

import { config } from './config.js';

const LN2 = Math.log(2);

export class RecencyTracker {
  constructor(halfLifeMs = config.recency.halfLifeMs) {
    this.lambda = LN2 / halfLifeMs; // decay rate
    this.scores = new Map(); // query -> { score, lastTs }
  }

  _decayed(entry, now) {
    return entry.score * Math.exp(-this.lambda * (now - entry.lastTs));
  }

  // Record a search occurrence (called on every POST /search).
  record(query, now = Date.now()) {
    const entry = this.scores.get(query);
    if (entry) {
      entry.score = this._decayed(entry, now) + 1;
      entry.lastTs = now;
    } else {
      this.scores.set(query, { score: 1, lastTs: now });
    }
    // Occasionally prune fully-decayed entries to bound memory.
    if (this.scores.size > 50_000) this._prune(now);
  }

  // Current decayed recency score for a single query.
  score(query, now = Date.now()) {
    const entry = this.scores.get(query);
    return entry ? this._decayed(entry, now) : 0;
  }

  // Top-N trending queries by current decayed score.
  trending(limit = config.recency.trendingSize, now = Date.now()) {
    const arr = [];
    for (const [query, entry] of this.scores) {
      const s = this._decayed(entry, now);
      if (s > 0.01) arr.push({ query, score: +s.toFixed(3) });
    }
    arr.sort((a, b) => b.score - a.score);
    return arr.slice(0, limit);
  }

  _prune(now) {
    for (const [q, entry] of this.scores) {
      if (this._decayed(entry, now) < 0.01) this.scores.delete(q);
    }
  }
}
