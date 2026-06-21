// Central place for all tunable knobs. Every magic number in the system lives
// here so design choices are easy to find and explain during the viva.

export const config = {
  // ---- HTTP ----
  port: Number(process.env.PORT) || 3001,

  // ---- Paths ----
  dbPath: process.env.DB_PATH || new URL('../data/typeahead.db', import.meta.url).pathname,
  csvPath: new URL('../data/queries.csv', import.meta.url).pathname,

  // ---- Suggestions ----
  // How many suggestions the API returns to the client.
  maxSuggestions: 10,
  // How many candidates each trie node keeps. Must be >= maxSuggestions so the
  // recency-aware re-ranking has room to promote a "trending" item above a
  // historically-popular one within the same prefix.
  candidatePoolSize: 50,

  // ---- Distributed cache ----
  cache: {
    nodeCount: 4,            // number of logical cache nodes
    virtualNodesPerNode: 150, // vnodes per physical node on the hash ring
    ttlMs: 30_000,           // entry time-to-live
    maxEntriesPerNode: 5_000 // simple LRU bound per node
  },

  // ---- Batch writes ----
  batch: {
    flushIntervalMs: 2_000,  // flush on a timer ...
    maxBufferOps: 500        // ... or when this many buffered increments accumulate
  },

  // ---- Recency / trending ----
  recency: {
    // Half-life of a search's contribution to the recency score, in ms.
    // After this much time a single search counts for half as much.
    halfLifeMs: 10 * 60 * 1000, // 10 minutes
    trendingSize: 10            // how many trending searches to return
  },

  // ---- Ranking weights (enhanced / recency-aware mode) ----
  // combinedScore = wPopularity * log10(count+1) + wRecency * recencyScore
  ranking: {
    wPopularity: 1.0,
    wRecency: 3.0
  }
};
