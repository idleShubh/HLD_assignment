# Architecture

## Components

| Component | File | Responsibility |
| --- | --- | --- |
| Express server | `server.js` | HTTP routes; serves the built React UI |
| SuggestionService | `suggestionService.js` | Orchestrates read / write / flush paths |
| Trie | `trie.js` | Prefix index; each node caches its top-N queries |
| DistributedCache | `distributedCache.js` | N logical cache nodes (TTL + LRU) |
| ConsistentHashRing | `consistentHash.js` | Maps prefix key → owning cache node |
| RecencyTracker | `recency.js` | Time-decayed scores → trending + recency rank |
| BatchWriter | `batchWriter.js` | Buffers + aggregates search counts, flushes in batches |
| SQLite store | `db.js` | Durable query→count store (read once, written in batches) |

## Component diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                            React UI (Vite)                            │
│  search box · debounced suggest · keyboard nav · trending · states    │
└───────────────┬───────────────────────────────────┬──────────────────┘
        GET /suggest                            POST /search
                │                                       │
┌───────────────▼───────────────────────────────────────▼──────────────┐
│                          Express (server.js)                          │
│                                                                       │
│                       SuggestionService                               │
│   ┌─────────────┐    miss    ┌──────────┐    rank    ┌─────────────┐  │
│   │ Distributed │ ─────────▶ │   Trie   │ ─────────▶ │  Recency    │  │
│   │   Cache     │ ◀───fill── │ (top-N)  │            │  Tracker    │  │
│   │ + hash ring │            └──────────┘            └─────────────┘  │
│   └─────────────┘                                          ▲          │
│         ▲                                                  │ live     │
│         │ invalidate                                       │          │
│   ┌─────┴───────┐   flush (timer / size)   ┌──────────────┴───────┐  │
│   │ BatchWriter │ ───────────────────────▶ │   SQLite primary     │  │
│   │  (buffer)   │                          │   (read once @ boot) │  │
│   └─────────────┘                          └──────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

## Data flows

### Read — `GET /suggest?q=iph&mode=count`
1. Normalize prefix (lowercase/trim).
2. Build cache key `sug:<mode>:<prefix>`; ring picks the owning node.
3. **Cache hit** → return stored suggestions (the common case).
4. **Cache miss** → read candidate pool from the trie node for that prefix,
   rank (by count, or by the popularity+recency blend), keep top 10, store in
   the cache with TTL, return.

### Write — `POST /search`
1. Normalize query.
2. Update the in-memory live count (so the next flush knows the new total).
3. Record into the RecencyTracker (trending updates immediately).
4. Add to the BatchWriter buffer; return `{ "message": "Searched" }` at once.
   No synchronous DB write.

### Flush — every 2s or 500 buffered increments
1. Aggregate buffered deltas → one SQLite transaction (`+delta` upserts).
2. Refresh the trie's top-N pools for affected queries.
3. Invalidate cache keys for every prefix of each affected query (both modes).

## Why these choices (summary)

- **Trie + per-node top-N pool** → O(prefix length) suggestions, no scans.
- **Consistent hashing** → even key spread + minimal remap on node changes.
- **TTL + LRU per cache node** → bounded memory, no permanently-stale data.
- **Decayed recency** → real-time trending that self-corrects after spikes.
- **Batch writes** → ~99% fewer DB writes; bounded crash-loss window.

See the README for trade-offs and measured performance.
