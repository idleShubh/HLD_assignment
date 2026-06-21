// SQLite primary data store. This is the durable source of truth for
// query -> count. Suggestions are NOT served from here at request time (they
// come from the in-memory trie + distributed cache); the DB is read once at
// startup and written to only in batches. We keep counters so the performance
// report can show how few DB operations actually happen per search.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;
const metrics = { reads: 0, writes: 0, flushes: 0 };

export function initDb() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  // WAL + relaxed sync = much faster batched writes, durable enough for a demo.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      query         TEXT PRIMARY KEY,
      count         INTEGER NOT NULL DEFAULT 0,
      last_searched INTEGER
    );
  `);
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialised — call initDb() first');
  return db;
}

// Read the entire table once at boot to build the in-memory trie.
export function loadAllRows() {
  metrics.reads += 1;
  return getDb().prepare('SELECT query, count, last_searched FROM queries').all();
}

export function rowCount() {
  metrics.reads += 1;
  return getDb().prepare('SELECT COUNT(*) AS n FROM queries').get().n;
}

// Batch upsert: add `delta` to existing counts (or insert new rows). Runs in a
// single transaction so N buffered increments cost ~1 fsync, not N.
const upsertOne = () =>
  getDb().prepare(`
    INSERT INTO queries (query, count, last_searched)
    VALUES (@query, @delta, @ts)
    ON CONFLICT(query) DO UPDATE SET
      count = count + excluded.count,
      last_searched = excluded.last_searched
  `);

let _upsertStmt;
export function flushBatch(entries) {
  // entries: [{ query, delta, ts }]
  if (!entries.length) return 0;
  if (!_upsertStmt) _upsertStmt = upsertOne();
  const tx = getDb().transaction((rows) => {
    for (const r of rows) {
      _upsertStmt.run({ query: r.query, delta: r.delta, ts: r.ts });
      metrics.writes += 1;
    }
  });
  tx(entries);
  metrics.flushes += 1;
  return entries.length;
}

// Bulk insert for seeding (overwrites counts rather than adding).
export function bulkInsert(rows) {
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO queries (query, count, last_searched) VALUES (?, ?, ?)'
  );
  const tx = getDb().transaction((batch) => {
    for (const r of batch) {
      stmt.run(r.query, r.count, r.last_searched);
      metrics.writes += 1;
    }
  });
  tx(rows);
}

export function dbMetrics() {
  return { ...metrics };
}
