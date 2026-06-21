// Distributed cache for suggestion results.
//
// Multiple *logical* cache nodes (in-process here, but each is an independent
// store — in production each would be a separate Redis/Memcached box). A
// consistent-hash ring decides which node owns a given prefix key, so the same
// prefix always routes to the same node (cache affinity) and adding/removing a
// node only remaps ~1/N of the keys. Each node has TTL expiry + an LRU bound so
// stale data doesn't live forever.

import { ConsistentHashRing } from './consistentHash.js';
import { config } from './config.js';

class CacheNode {
  constructor(id, ttlMs, maxEntries) {
    this.id = id;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expiresAt }; Map order = LRU order
    this.hits = 0;
    this.misses = 0;
  }

  _fresh(entry) {
    return entry && entry.expiresAt > Date.now();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!this._fresh(entry)) {
      if (entry) this.store.delete(key); // expired -> drop
      this.misses += 1;
      return undefined;
    }
    // LRU touch: re-insert to move to the most-recent end.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  has(key) {
    return this._fresh(this.store.get(key));
  }

  set(key, value) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value; // evict LRU
      this.store.delete(oldest);
    }
  }

  delete(key) {
    return this.store.delete(key);
  }
}

export class DistributedCache {
  constructor() {
    const { nodeCount, virtualNodesPerNode, ttlMs, maxEntriesPerNode } = config.cache;
    this.nodeIds = Array.from({ length: nodeCount }, (_, i) => `cache-node-${i}`);
    this.ring = new ConsistentHashRing(this.nodeIds, virtualNodesPerNode);
    this.nodes = new Map(
      this.nodeIds.map((id) => [id, new CacheNode(id, ttlMs, maxEntriesPerNode)])
    );
  }

  static keyFor(mode, prefix) {
    return `sug:${mode}:${prefix}`;
  }

  nodeFor(key) {
    return this.ring.getNode(key);
  }

  get(key) {
    const nodeId = this.nodeFor(key);
    return this.nodes.get(nodeId).get(key);
  }

  set(key, value) {
    const nodeId = this.nodeFor(key);
    this.nodes.get(nodeId).set(key, value);
  }

  delete(key) {
    const nodeId = this.nodeFor(key);
    return this.nodes.get(nodeId).delete(key);
  }

  // When a query's ranking changes (a search came in / a batch flushed), the
  // cached results for every prefix of that query may now be stale. Invalidate
  // them in both ranking modes so the next read recomputes fresh data.
  invalidatePrefixesOf(query, modes = ['count', 'recency']) {
    const q = (query || '').toLowerCase().trim();
    let removed = 0;
    for (let i = 1; i <= q.length; i++) {
      const prefix = q.slice(0, i);
      for (const mode of modes) {
        if (this.delete(DistributedCache.keyFor(mode, prefix))) removed += 1;
      }
    }
    return removed;
  }

  // Non-mutating inspection for GET /cache/debug.
  inspect(mode, prefix) {
    const key = DistributedCache.keyFor(mode, prefix);
    const nodeId = this.nodeFor(key);
    const node = this.nodes.get(nodeId);
    return { key, node: nodeId, status: node.has(key) ? 'hit' : 'miss' };
  }

  metrics() {
    let hits = 0;
    let misses = 0;
    const perNode = {};
    for (const [id, n] of this.nodes) {
      hits += n.hits;
      misses += n.misses;
      perNode[id] = { hits: n.hits, misses: n.misses, entries: n.store.size };
    }
    const total = hits + misses;
    return {
      hits,
      misses,
      hitRate: total ? +(hits / total).toFixed(4) : 0,
      perNode
    };
  }
}
