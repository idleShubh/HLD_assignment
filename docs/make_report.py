#!/usr/bin/env python3
"""Generate a plain, simple Project Report PDF for the Search Typeahead System."""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted, Table, TableStyle,
    PageBreak, Image, ListFlowable, ListItem,
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Project_Report.pdf")
SHOTS = os.path.join(HERE, "screenshots")

styles = getSampleStyleSheet()

# --- plain styles: default fonts (Helvetica / Courier), no fancy design ---
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                    fontSize=15, spaceBefore=14, spaceAfter=8, textColor=colors.black)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                    fontSize=12, spaceBefore=10, spaceAfter=5, textColor=colors.black)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontName="Helvetica",
                      fontSize=10, leading=14, alignment=TA_LEFT, spaceAfter=6)
MONO = ParagraphStyle("MONO", parent=styles["Code"], fontName="Courier",
                      fontSize=7.2, leading=8.6, textColor=colors.black)
CODE = ParagraphStyle("CODE", parent=styles["Code"], fontName="Courier",
                      fontSize=8.5, leading=11, textColor=colors.black)
TITLE = ParagraphStyle("TITLE", parent=styles["Title"], fontName="Helvetica-Bold",
                       fontSize=22, spaceAfter=6, textColor=colors.black)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], fontName="Helvetica",
                     fontSize=11, textColor=colors.black, spaceAfter=2)

story = []


def p(text, style=BODY):
    story.append(Paragraph(text, style))


def bullets(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, BODY), leftIndent=10) for t in items],
        bulletType="bullet", start="-", leftIndent=14,
    ))


def mono_block(text):
    story.append(Preformatted(text, MONO))
    story.append(Spacer(1, 6))


def code_block(text):
    story.append(Preformatted(text, CODE))
    story.append(Spacer(1, 6))


def simple_table(data, col_widths):
    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))


# ====================== TITLE ======================
p("Project Report", TITLE)
p("Search Typeahead (Autocomplete) System", SUB)
p("Distributed cache &middot; consistent hashing &middot; trending &middot; batch writes", SUB)
story.append(Spacer(1, 6))
p("Author: Shubh Srivastava &nbsp;|&nbsp; Date: 22 June 2026", SUB)
story.append(Spacer(1, 10))

p("<b>Overview.</b> A search typeahead system that suggests popular queries as you "
  "type, records submitted searches, and serves suggestions with low latency from a "
  "distributed in-memory cache routed by consistent hashing. It supports trending "
  "searches (recency-aware ranking) and batch writes so the database is not hammered "
  "on every keystroke. The stack is a Node.js / Express backend, a SQLite primary "
  "store, and a React (Vite) front end.")

story.append(Spacer(1, 4))
p("<b>Contents:</b> 1. Architecture &nbsp; 2. Dataset &amp; loading &nbsp; "
  "3. API documentation &nbsp; 4. Design choices &amp; trade-offs &nbsp; "
  "5. Performance report")

story.append(PageBreak())

# ====================== 1. ARCHITECTURE ======================
p("1. Architecture", H1)

p("The system is split into a thin HTTP layer and a set of focused in-memory "
  "components orchestrated by a single SuggestionService. Suggestion reads are "
  "served from memory (cache and trie); the SQLite database is read only once at "
  "startup and written only in batches.")

p("1.1 Components", H2)
simple_table([
    ["Component", "File", "Responsibility"],
    ["Express server", "server.js", "HTTP routes; serves the built React UI"],
    ["SuggestionService", "suggestionService.js", "Orchestrates read / write / flush paths"],
    ["Trie", "trie.js", "Prefix index; each node caches its top-N queries"],
    ["DistributedCache", "distributedCache.js", "N logical cache nodes (TTL + LRU)"],
    ["ConsistentHashRing", "consistentHash.js", "Maps prefix key -> owning cache node"],
    ["RecencyTracker", "recency.js", "Time-decayed scores -> trending + recency rank"],
    ["BatchWriter", "batchWriter.js", "Buffers + aggregates counts, flushes in batches"],
    ["SQLite store", "db.js", "Durable query->count store (read once, batched writes)"],
], [110, 120, 250])

p("1.2 Component diagram", H2)
mono_block(
r"""+----------------------------------------------------------------------+
|                          React UI (Vite)                             |
|   search box . debounced suggest . keyboard nav . trending . states  |
+---------------+-----------------------------------+------------------+
        GET /suggest                            POST /search
                |                                       |
+---------------v---------------------------------------v--------------+
|                          Express (server.js)                         |
|                                                                      |
|                       SuggestionService                              |
|   +-------------+   miss     +----------+    rank    +------------+   |
|   | Distributed | ---------> |   Trie   | ---------> |  Recency   |   |
|   |   Cache     | <---fill-- | (top-N)  |            |  Tracker   |   |
|   | + hash ring |            +----------+            +------------+   |
|   +-------------+                                          ^         |
|         ^                                                  | live    |
|         | invalidate                                       |         |
|   +-----+-------+   flush (timer / size)   +---------------+------+  |
|   | BatchWriter | -----------------------> |   SQLite primary     |  |
|   |  (buffer)   |                          |   (read once @ boot) |  |
|   +-------------+                          +----------------------+  |
+----------------------------------------------------------------------+""")

p("1.3 Data flows", H2)

p("<b>Read &mdash; GET /suggest?q=iph&amp;mode=count</b>")
bullets([
    "Normalize the prefix (lowercase / trim).",
    "Build cache key <font face='Courier'>sug:&lt;mode&gt;:&lt;prefix&gt;</font>; the hash ring picks the owning node.",
    "Cache hit -> return stored suggestions (the common case).",
    "Cache miss -> read the candidate pool from the trie node for that prefix, rank it "
    "(by count, or by the popularity+recency blend), keep the top 10, store in the cache "
    "with TTL, and return.",
])

p("<b>Write &mdash; POST /search</b>")
bullets([
    "Normalize the query.",
    "Update the in-memory live count so the next flush knows the new total.",
    "Record into the RecencyTracker (trending updates immediately).",
    "Add to the BatchWriter buffer and return at once &mdash; no synchronous DB write.",
])

p("<b>Flush &mdash; every 2s or 500 buffered increments</b>")
bullets([
    "Aggregate buffered deltas into one SQLite transaction (<font face='Courier'>+delta</font> upserts).",
    "Refresh the trie's top-N pools for affected queries.",
    "Invalidate cache keys for every prefix of each affected query (both modes).",
])

story.append(PageBreak())

# ====================== 2. DATASET ======================
p("2. Dataset source and loading", H1)

p("2.1 Source", H2)
bullets([
    "<b>Source:</b> generated locally by <font face='Courier'>backend/src/seed.js</font>. "
    "The spec allows any dataset and permits deriving counts by aggregation.",
    "<b>How counts are derived:</b> queries are built by combining real brand / product / "
    "tech vocabulary across several query templates, then assigned counts from a Zipf-like "
    "(power-law) distribution &mdash; a few head queries are searched enormously, a long "
    "tail barely at all. This matches how real search traffic is shaped.",
    "<b>Reproducible:</b> a fixed PRNG seed (mulberry32, seed 42) means every run produces "
    "the exact same dataset.",
    "<b>Size:</b> 120,000 unique queries (above the 100k minimum).",
    "<b>Output:</b> <font face='Courier'>backend/data/queries.csv</font> (columns "
    "<font face='Courier'>query,count</font>) and the SQLite DB "
    "<font face='Courier'>backend/data/typeahead.db</font>.",
])

p("2.2 Loading instructions", H2)
p("Requirements: Node 18+ (tested on Node 20). Run from the project root:")
code_block(
"""npm install            # installs concurrently (for the dev script)
npm run install:all    # installs backend + frontend deps
npm run seed           # generate dataset (120k queries) + load SQLite

# Option A - one-command demo (backend serves the built UI on :3001)
npm run build          # build the React UI into frontend/dist
npm start              # http://localhost:3001

# Option B - dev mode (hot reload): backend :3001, UI :5173
npm run dev            # then open http://localhost:5173

# Measure performance (server must be running)
npm run benchmark""")

p("<font face='Courier'>npm run seed</font> writes the CSV and bulk-inserts into SQLite in "
  "one transaction. The server reads the table <b>once at startup</b> to build the in-memory "
  "trie; after that, suggestion reads never touch the DB.")

story.append(PageBreak())

# ====================== 3. API ======================
p("3. API documentation", H1)
p("Base URL: <font face='Courier'>http://localhost:3001</font>")

p("3.1 GET /suggest?q=&lt;prefix&gt;&amp;mode=count|recency", H2)
p("Returns up to 10 prefix-matching suggestions sorted by ranking.")
bullets([
    "<font face='Courier'>q</font> &mdash; the typed prefix (case-insensitive; empty / missing -> empty list).",
    "<font face='Courier'>mode</font> &mdash; <font face='Courier'>count</font> (basic, all-time "
    "popularity, default) or <font face='Courier'>recency</font> (enhanced, blends popularity "
    "with recent activity).",
])
code_block(
"""{
  "query": "iph", "mode": "count", "source": "cache",
  "cacheNode": "cache-node-0", "count": 10, "latencyMs": 0.18,
  "suggestions": [{ "query": "iphone", "count": 100001 }, ...]
}""")
p("<font face='Courier'>source</font> is <font face='Courier'>cache</font> (hit), "
  "<font face='Courier'>compute</font> (miss -> built from trie), or "
  "<font face='Courier'>empty</font>.")

p("3.2 POST /search &nbsp; body { \"query\": \"iphone\" }", H2)
p("Records the search and returns a dummy response. Increments the count if the query "
  "exists, inserts it with an initial count if not.")
code_block('{ "message": "Searched", "query": "iphone", "count": 100002 }')

p("3.3 GET /cache/debug?prefix=&lt;prefix&gt;&amp;mode=count|recency", H2)
p("Shows which cache node owns the prefix key and whether it is currently a hit or miss "
  "(non-mutating).")
code_block('{ "prefix": "iph", "key": "sug:count:iph", "node": "cache-node-0", "status": "hit" }')

p("3.4 GET /trending", H2)
p("Top trending searches by decayed recent activity.")
code_block('{ "trending": [{ "query": "iphone", "recencyScore": 12.4, "count": 100050 }] }')

p("3.5 GET /metrics", H2)
p("Cache hit rate (overall + per node), batch-write counters, DB read/write counts, "
  "consistent-hashing key distribution, and /suggest latency percentiles (p50 / p95 / p99). "
  "Used by the benchmark and for the performance report.")

story.append(PageBreak())

# ====================== 4. DESIGN ======================
p("4. Design choices and trade-offs", H1)

p("Primary store &mdash; SQLite", H2)
p("A real on-disk DB so DB read/write counts are genuine. WAL + "
  "<font face='Courier'>synchronous=NORMAL</font> make batched writes fast while staying "
  "durable enough for the demo.")

p("Suggestions &mdash; in-memory trie with a precomputed candidate pool", H2)
p("Each trie node caches the top-N (50) highest-count queries under that prefix, so "
  "/suggest is O(prefix length), never a full scan. The pool is bigger than the 10 we "
  "return so the recency re-ranker has room to promote a trending query. "
  "<b>Trade-off:</b> a query ranked below the 50th by count cannot be surfaced by recency "
  "for that prefix &mdash; bounded memory &amp; latency vs. perfect freshness.")

p("Cache &mdash; distributed, consistent-hashed", H2)
p("4 logical cache nodes; a consistent hash ring with 150 virtual nodes per node decides "
  "ownership. The same prefix always routes to the same node (affinity), and adding / "
  "removing a node only remaps ~1/N of keys. Each node has a TTL (30s) + an LRU bound so "
  "stale data cannot live forever. <b>Trade-off:</b> in-process logical nodes keep the demo "
  "runnable on one machine; in production each node would be a separate Redis / Memcached "
  "box behind the same (unchanged) ring logic.")

p("Trending &mdash; time-decayed recency score", H2)
p("Each query keeps one exponentially-decayed counter (10-min half-life), updated live on "
  "every search, so trending feels real-time. Decay means a short viral spike fades on its "
  "own &mdash; this is exactly how the system avoids permanently over-ranking a briefly-popular "
  "query. Enhanced ranking blends: "
  "<font face='Courier'>score = 1.0 &middot; log10(count+1) + 3.0 &middot; recencyScore</font>.")

p("Batch writes", H2)
p("Search submissions land in an in-memory buffer keyed by query (so 50 searches for "
  "\"iphone\" aggregate into one <font face='Courier'>+50</font>). The buffer flushes on a 2s "
  "timer <b>or</b> at 500 buffered increments, as a single SQLite transaction. "
  "<b>Failure trade-off:</b> the buffer is in memory, so a crash before a flush loses at most "
  "the last interval's increments. That is acceptable for popularity counters; if counts had "
  "to be exact we would add a write-ahead log before acknowledging.")

p("Cache invalidation on ranking change", H2)
p("When a search is recorded and later flushed, the cached results for every prefix of that "
  "query are invalidated (in both modes) so the next read recomputes fresh rankings; TTL "
  "covers everything else.")

story.append(PageBreak())

# ====================== 5. PERFORMANCE ======================
p("5. Performance report", H1)
p("Measured locally with <font face='Courier'>npm run benchmark</font> (Node 20, 120k-query "
  "dataset, 4 cache nodes). Numbers vary by machine; reproduce with the command.")

simple_table([
    ["Metric", "Result"],
    ["Suggestion latency - warm (cache hit)", "p50 ~ 0.11 ms, p95 ~ 0.5 ms (HTTP round-trip)"],
    ["Suggestion latency - cold (compute)", "p50 ~ 0.17 ms, p95 ~ 0.5 ms"],
    ["Server-side /suggest compute", "p50 0.003 ms, p95 0.008 ms"],
    ["Cache hit rate (after warm-up)", "~ 98%"],
    ["Batch writes: 5,031 searches", "-> 57 DB rows written across 13 flushes"],
    ["Write reduction via batching", "~ 98.9% fewer DB writes"],
    ["Consistent-hashing distribution (676 keys / 4 nodes)", "~ 181 / 184 / 153 / 158 (even)"],
], [250, 230])

p("<b>Cache vs DB reads:</b> suggestion reads are served entirely from the trie + cache; the "
  "DB is read only once at startup. So the DB read count stays flat regardless of query volume.")

p("5.1 Basic vs. enhanced ranking", H2)
p("In the UI, toggle Popularity (basic) vs Recency-aware (enhanced), or via API:")
code_block(
"""# burst-search a low-count tail query
for i in $(seq 1 30); do curl -s -XPOST localhost:3001/search \\
  -H 'content-type: application/json' -d '{"query":"iphone sale"}' >/dev/null; done
sleep 3
curl -s "localhost:3001/suggest?q=iph&mode=count"    # "iphone sale" stays near bottom
curl -s "localhost:3001/suggest?q=iph&mode=recency"  # "iphone sale" jumps to top, then decays""")
p("In recency mode a freshly-searched, low-count query is promoted to the top, while "
  "popularity mode keeps the all-time leaders first.")

# Screenshots, if present
shot1 = os.path.join(SHOTS, "01-suggestions.png")
shot3 = os.path.join(SHOTS, "03-recency-mode.png")
if os.path.exists(shot1) or os.path.exists(shot3):
    p("5.2 Screenshots", H2)
    for label, path in [("Popularity (basic) ranking", shot1),
                        ("Recency-aware (enhanced) ranking", shot3)]:
        if os.path.exists(path):
            p("<b>%s</b>" % label, BODY)
            img = Image(path)
            maxw = 460
            if img.imageWidth > maxw:
                ratio = maxw / float(img.imageWidth)
                img.drawWidth = maxw
                img.drawHeight = img.imageHeight * ratio
            img.hAlign = "LEFT"
            story.append(img)
            story.append(Spacer(1, 8))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.grey)
    canvas.drawString(20 * mm, 12 * mm, "Search Typeahead System - Project Report")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, "Page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=20 * mm, rightMargin=20 * mm,
    topMargin=18 * mm, bottomMargin=20 * mm,
    title="Project Report - Search Typeahead System",
    author="Shubh Srivastava",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
