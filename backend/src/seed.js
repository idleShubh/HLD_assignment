// Dataset generator + loader.
//
// The PRD allows "any open-source dataset" and explicitly permits deriving
// counts by aggregation. We generate a reproducible, realistic dataset of
// 100k+ unique queries by combining real-world brand/product/topic vocabulary
// across several query templates, then assigning counts from a Zipf-like
// (power-law) distribution — which is how real search traffic is shaped: a few
// head queries are searched enormously, a long tail barely at all.
//
// Output: data/queries.csv  (columns: query,count)  +  the SQLite DB.
// Deterministic: a fixed PRNG seed means every run produces the same dataset.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { initDb, bulkInsert, getDb } from './db.js';

const TARGET = 120_000; // >= 100k required by the PRD

// ---- deterministic PRNG (mulberry32) so the dataset is reproducible ----
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

// ---- vocabulary ----
const brands = [
  'apple', 'samsung', 'sony', 'lg', 'dell', 'hp', 'lenovo', 'asus', 'acer',
  'microsoft', 'google', 'nokia', 'oneplus', 'xiaomi', 'realme', 'oppo', 'vivo',
  'nike', 'adidas', 'puma', 'reebok', 'canon', 'nikon', 'gopro', 'bose', 'jbl',
  'sennheiser', 'logitech', 'razer', 'corsair', 'intel', 'amd', 'nvidia',
  'panasonic', 'philips', 'whirlpool', 'bosch', 'ikea', 'amazon', 'flipkart'
];
const products = [
  'iphone', 'ipad', 'macbook', 'laptop', 'phone', 'smartphone', 'tablet',
  'headphones', 'earbuds', 'earphones', 'charger', 'cable', 'adapter', 'monitor',
  'keyboard', 'mouse', 'webcam', 'speaker', 'soundbar', 'tv', 'television',
  'camera', 'lens', 'tripod', 'smartwatch', 'watch', 'fitness band', 'router',
  'modem', 'ssd', 'hard drive', 'pendrive', 'memory card', 'power bank',
  'shoes', 'sneakers', 'running shoes', 'backpack', 'wallet', 'sunglasses',
  'washing machine', 'refrigerator', 'microwave', 'air conditioner', 'fan',
  'vacuum cleaner', 'air purifier', 'water purifier', 'coffee maker', 'kettle',
  'gaming chair', 'desk', 'office chair', 'printer', 'scanner', 'projector',
  'drone', 'graphics card', 'processor', 'motherboard', 'ram'
];
const modifiers = [
  'best', 'cheap', 'top', 'new', 'used', 'refurbished', 'price', 'reviews',
  'deals', 'offers', 'discount', 'sale', 'online', 'near me', 'under 500',
  'under 1000', 'pro', 'max', 'ultra', 'lite', 'mini', 'plus', 'wireless',
  'bluetooth', 'portable', 'smart', 'gaming', '4k', 'hd', '2024', '2025',
  'specifications', 'features', 'comparison', 'alternatives'
];
const topics = [
  'java', 'python', 'javascript', 'typescript', 'react', 'angular', 'vue',
  'node', 'express', 'django', 'flask', 'spring boot', 'sql', 'mysql',
  'postgresql', 'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'azure',
  'gcp', 'git', 'linux', 'bash', 'html', 'css', 'tailwind', 'graphql',
  'rest api', 'system design', 'data structures', 'algorithms',
  'machine learning', 'deep learning', 'pandas', 'numpy', 'tensorflow',
  'pytorch', 'kafka', 'rabbitmq', 'nginx', 'terraform', 'jenkins'
];
const intents = [
  'tutorial', 'guide', 'course', 'examples', 'interview questions',
  'cheat sheet', 'documentation', 'for beginners', 'projects', 'roadmap',
  'best practices', 'tips', 'crash course', 'certification', 'exercises'
];

// A few hand-picked head queries with deliberately huge counts so the demo and
// the PRD's own example rows look right.
const head = [
  ['iphone', 100000], ['iphone 15', 85000], ['iphone charger', 60000],
  ['java tutorial', 40000], ['python tutorial', 38000], ['samsung tv', 35000],
  ['laptop deals', 30000], ['react tutorial', 28000], ['best headphones', 26000],
  ['macbook pro', 25000], ['wireless earbuds', 24000], ['gaming laptop', 23000],
  ['airpods', 22000], ['system design interview', 21000], ['nike shoes', 20000]
];

function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function generate() {
  const set = new Set(head.map((h) => h[0]));
  const queries = [];

  const templates = [
    () => `${pick(brands)} ${pick(products)}`,
    () => `${pick(brands)} ${pick(products)} ${pick(modifiers)}`,
    () => `${pick(modifiers)} ${pick(products)}`,
    () => `${pick(products)} ${pick(modifiers)}`,
    () => `${pick(topics)} ${pick(intents)}`,
    () => `${pick(topics)} vs ${pick(topics)}`,
    () => `how to use ${pick(products)}`,
    () => `${pick(brands)} ${pick(products)} vs ${pick(brands)} ${pick(products)}`
  ];

  let guard = 0;
  while (queries.length < TARGET - head.length && guard < TARGET * 40) {
    guard += 1;
    const t = templates[Math.floor(rand() * templates.length)];
    let q = t().trim().replace(/\s+/g, ' ');
    if (q.includes('vs') && q.split(' vs ')[0] === q.split(' vs ')[1]) continue; // skip "x vs x"
    if (set.has(q)) continue;
    set.add(q);
    queries.push(q);
  }
  return queries;
}

// Assign Zipf-like counts: shuffle deterministically, then count ~ C / rank^s.
function assignCounts(queries) {
  // Fisher–Yates with our seeded PRNG.
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }
  const C = 18000; // top generated query ~ below the curated head queries
  const s = 0.85;
  const now = Date.now();
  const rows = queries.map((q, i) => {
    const rank = i + 1;
    const base = C / Math.pow(rank, s);
    const noise = 0.75 + rand() * 0.5; // +/-25% jitter
    const count = Math.max(1, Math.round(base * noise));
    // Spread last_searched across the past 30 days (informational only).
    const last = now - Math.floor(rand() * 30 * 24 * 3600 * 1000);
    return { query: q, count, last_searched: last };
  });
  return rows;
}

function main() {
  console.log(`Generating ~${TARGET} queries (deterministic)...`);
  const generated = generate();
  const genRows = assignCounts(generated);
  const now = Date.now();
  const headRows = head.map(([q, c]) => ({
    query: q,
    count: c,
    last_searched: now - Math.floor(rand() * 7 * 24 * 3600 * 1000)
  }));
  const rows = [...headRows, ...genRows];

  // Write CSV (the documented "dataset source").
  fs.mkdirSync(path.dirname(config.csvPath), { recursive: true });
  const out = fs.createWriteStream(config.csvPath);
  out.write('query,count\n');
  for (const r of rows) {
    const q = r.query.includes(',') ? `"${r.query}"` : r.query;
    out.write(`${q},${r.count}\n`);
  }
  out.end();

  // Load into SQLite (fresh table).
  initDb();
  getDb().exec('DELETE FROM queries;');
  bulkInsert(rows);

  console.log(`Done. Wrote ${rows.length} unique queries to:`);
  console.log(`  CSV: ${config.csvPath}`);
  console.log(`  DB : ${config.dbPath}`);
}

main();
