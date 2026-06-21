// HTTP layer. Thin routes over SuggestionService.
//
// Endpoints (per the PRD's API table + a couple of allowed extras):
//   GET  /suggest?q=<prefix>&mode=count|recency   -> up to 10 suggestions
//   POST /search        { query }                 -> { message: "Searched" } + records it
//   GET  /cache/debug?prefix=<prefix>&mode=        -> owning cache node + hit/miss
//   GET  /trending                                -> top trending searches
//   GET  /metrics                                 -> cache hit rate, batch/DB counts, ring
//   GET  /health

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { SuggestionService } from './suggestionService.js';

const app = express();
app.use(cors());
app.use(express.json());

const service = new SuggestionService();
const { loaded } = service.init();
console.log(`Loaded ${loaded} queries into the trie.`);

// --- tiny p95 latency recorder for /suggest (non-functional reporting) ---
const latencies = [];
function record(ms) {
  latencies.push(ms);
  if (latencies.length > 5000) latencies.shift();
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return +sorted[idx].toFixed(3);
}

// GET /suggest
app.get('/suggest', (req, res) => {
  const start = process.hrtime.bigint();
  const q = req.query.q ?? '';
  const mode = req.query.mode ?? 'count';
  const result = service.suggest(q, mode);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  record(ms);
  res.json({
    query: String(q),
    mode: result.mode,
    source: result.source, // "cache" | "compute" | "empty"
    cacheNode: result.node,
    count: result.suggestions.length,
    latencyMs: +ms.toFixed(3),
    suggestions: result.suggestions
  });
});

// POST /search  -> dummy response + records the query
app.post('/search', (req, res) => {
  const query = req.body?.query ?? req.query.query ?? '';
  const r = service.submitSearch(query);
  if (!r.ok) return res.status(400).json({ message: 'Searched', error: r.error });
  res.json({ message: 'Searched', query: r.query, count: r.count });
});

// GET /cache/debug
app.get('/cache/debug', (req, res) => {
  const prefix = req.query.prefix ?? '';
  const mode = req.query.mode ?? 'count';
  res.json(service.cacheDebug(prefix, mode));
});

// GET /trending
app.get('/trending', (_req, res) => {
  res.json({ trending: service.trending() });
});

// GET /metrics
app.get('/metrics', (_req, res) => {
  res.json({
    ...service.metrics(),
    suggestLatency: {
      samples: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99)
    }
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- serve the built React UI if it exists (single-command demo) ---
const dist = new URL('../../frontend/dist', import.meta.url).pathname;
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(config.port, () => {
  console.log(`Typeahead backend listening on http://localhost:${config.port}`);
});

// Flush the batch buffer on shutdown so we don't lose buffered increments.
function shutdown() {
  console.log('\nShutting down, flushing batch buffer...');
  service.shutdown();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
