// Consistent hashing ring with virtual nodes.
//
// Maps a prefix key -> the logical cache node that owns it. Virtual nodes
// (many ring points per physical node) keep the key distribution even and make
// add/remove of a node move only ~1/N of the keys instead of reshuffling all
// of them. Used to decide which cache node a /suggest prefix lives on.

import crypto from 'node:crypto';

function hash(str) {
  // 32-bit unsigned int from the first 8 hex chars of an md5 digest.
  const h = crypto.createHash('md5').update(str).digest('hex').slice(0, 8);
  return parseInt(h, 16);
}

export class ConsistentHashRing {
  constructor(nodeIds = [], vnodes = 150) {
    this.vnodes = vnodes;
    this.ring = []; // sorted [{ hash, nodeId }]
    this.nodes = new Set();
    for (const id of nodeIds) this.addNode(id);
  }

  _sort() {
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.add(nodeId);
    for (let i = 0; i < this.vnodes; i++) {
      this.ring.push({ hash: hash(`${nodeId}#${i}`), nodeId });
    }
    this._sort();
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);
    this.ring = this.ring.filter((p) => p.nodeId !== nodeId);
  }

  // First ring point clockwise from the key's hash (wrapping around).
  getNode(key) {
    if (this.ring.length === 0) return null;
    const h = hash(key);
    let lo = 0;
    let hi = this.ring.length - 1;
    if (h > this.ring[hi].hash) return this.ring[0].nodeId; // wrap
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    return this.ring[lo].nodeId;
  }

  // For the consistent-hashing evidence in the report: how keys spread across
  // nodes for a sample of prefixes.
  distribution(keys) {
    const dist = {};
    for (const id of this.nodes) dist[id] = 0;
    for (const k of keys) dist[this.getNode(k)] += 1;
    return dist;
  }
}
