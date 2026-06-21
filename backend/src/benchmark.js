// Performance harness. Run the server first (npm start), then `npm run benchmark`.
//
// Produces the numbers the PRD's performance report asks for:
//   - suggestion latency incl. p95 (cold vs warm cache)
//   - cache hit rate
//   - batch write reduction (searches received vs DB rows written)
//   - consistent-hashing key distribution across cache nodes

const BASE = process.env.BASE_URL || 'http://localhost:3001';

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3);
}
const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);

// Build a spread of realistic prefixes (1–3 chars) to exercise many cache keys.
function prefixes(n) {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const out = [];
  for (let i = 0; i < n; i++) {
    const len = 1 + (i % 3);
    let p = '';
    for (let j = 0; j < len; j++) p += letters[(i * 7 + j * 13) % 26];
    out.push(p);
  }
  return out;
}

async function timeSuggest(prefix, mode = 'count') {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/suggest?q=${encodeURIComponent(prefix)}&mode=${mode}`);
  const body = await res.json();
  return { ms: performance.now() - t0, source: body.source };
}

async function main() {
  console.log(`Benchmarking ${BASE}\n`);

  // --- 1. Cold reads (first hit per prefix => cache miss / compute) ---
  const ps = prefixes(2000);
  const cold = [];
  for (const p of ps) cold.push((await timeSuggest(p)).ms);

  // --- 2. Warm reads (same prefixes again => cache hits) ---
  const warm = [];
  for (const p of ps) warm.push((await timeSuggest(p)).ms);

  console.log('Suggestion latency (ms):');
  console.log(`  cold (compute): avg ${avg(cold)}  p50 ${percentile(cold, 50)}  p95 ${percentile(cold, 95)}  p99 ${percentile(cold, 99)}`);
  console.log(`  warm (cache)  : avg ${avg(warm)}  p50 ${percentile(warm, 50)}  p95 ${percentile(warm, 95)}  p99 ${percentile(warm, 99)}`);

  // --- 3. Batch write reduction: fire many searches over a small query set ---
  const queries = ['iphone', 'iphone 15', 'java tutorial', 'react tutorial', 'samsung tv'];
  const SUBMISSIONS = 5000;
  for (let i = 0; i < SUBMISSIONS; i++) {
    const q = queries[i % queries.length];
    await fetch(`${BASE}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
  }
  // Wait for at least one flush interval to elapse.
  await new Promise((r) => setTimeout(r, 2500));

  // --- 4. Pull server metrics ---
  const m = await (await fetch(`${BASE}/metrics`)).json();
  console.log('\nCache:');
  console.log(`  hit rate: ${(m.cache.hitRate * 100).toFixed(2)}%  (hits ${m.cache.hits}, misses ${m.cache.misses})`);
  console.log('  per-node entries:', Object.fromEntries(Object.entries(m.cache.perNode).map(([k, v]) => [k, v.entries])));

  console.log('\nBatch writes:');
  console.log(`  submissions received : ${m.batch.totalSubmissions}`);
  console.log(`  DB rows written      : ${m.batch.totalRowsWritten}`);
  console.log(`  flushes              : ${m.batch.totalFlushes}`);
  console.log(`  writes saved         : ${m.batch.writesSaved} (${m.batch.writeReductionPct}% reduction)`);

  console.log('\nConsistent hashing — key distribution across nodes (676 two-letter prefixes):');
  console.log(' ', m.ring.sampleDistribution);

  const trending = await (await fetch(`${BASE}/trending`)).json();
  console.log('\nTrending now:', trending.trending.map((t) => t.query).join(', '));

  console.log('\nServer-side /suggest latency window:', m.suggestLatency);
}

main().catch((e) => {
  console.error('Benchmark failed — is the server running on', BASE, '?\n', e.message);
  process.exit(1);
});
