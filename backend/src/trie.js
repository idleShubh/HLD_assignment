// In-memory prefix index for O(prefix length) suggestion lookups.
//
// Every node caches `top`: the highest-count queries that live under that
// prefix (capped at config.candidatePoolSize). So /suggest never scans the
// whole dataset — it walks `prefix.length` nodes and returns a precomputed,
// already-sorted list. The pool is bigger than the 10 we return so the
// recency-aware re-ranker has room to promote a trending query.

import { config } from './config.js';

export function normalize(s) {
  return (s || '').toLowerCase().trim();
}

class TrieNode {
  constructor() {
    this.children = new Map();
    this.top = []; // [{ query, count }] sorted by count desc, capped
    this.terminal = null; // { query, count } if a query ends here
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
    this.size = 0;
  }

  _walk(prefix, create = false) {
    let node = this.root;
    for (const ch of prefix) {
      let next = node.children.get(ch);
      if (!next) {
        if (!create) return null;
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    return node;
  }

  // Insert without maintaining `top` — used during the fast bulk build, which
  // computes `top` afterwards in one post-order pass.
  _insertRaw(query, count) {
    const node = this._walk(query, true);
    node.terminal = { query, count };
    this.size += 1;
  }

  // Bulk build: insert everything, then compute each node's top pool bottom-up.
  static build(rows) {
    const trie = new Trie();
    for (const r of rows) trie._insertRaw(normalize(r.query), r.count);
    trie._computeTops(trie.root);
    return trie;
  }

  _computeTops(node) {
    // Merge this node's own terminal entry with every child's top pool.
    const merged = [];
    if (node.terminal) merged.push(node.terminal);
    for (const child of node.children.values()) {
      this._computeTops(child);
      for (const e of child.top) merged.push(e);
    }
    merged.sort((a, b) => b.count - a.count);
    node.top = merged.slice(0, config.candidatePoolSize);
  }

  // Runtime update when a query's count changes (called from the batch flush).
  // Walks the query's prefix path and refreshes each node's top pool.
  update(query, newCount) {
    const norm = normalize(query);
    let node = this.root;
    const nodes = [this.root];
    for (const ch of norm) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
      nodes.push(next);
    }
    if (!node.terminal) this.size += 1;
    node.terminal = { query: norm, count: newCount };

    for (const n of nodes) {
      const filtered = n.top.filter((e) => e.query !== norm);
      filtered.push({ query: norm, count: newCount });
      filtered.sort((a, b) => b.count - a.count);
      n.top = filtered.slice(0, config.candidatePoolSize);
    }
  }

  // Candidate pool for a prefix (already sorted by count desc), up to pool size.
  getCandidates(prefix) {
    const node = this._walk(normalize(prefix));
    return node ? node.top : [];
  }
}
