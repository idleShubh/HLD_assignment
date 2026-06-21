import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSuggestions, submitSearch, fetchTrending } from './api.js';

const DEBOUNCE_MS = 250;

export default function App() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('count'); // 'count' = basic, 'recency' = enhanced
  const [suggestions, setSuggestions] = useState([]);
  const [meta, setMeta] = useState(null); // { source, cacheNode, latencyMs }
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchResult, setSearchResult] = useState(null);
  const [trending, setTrending] = useState([]);

  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  const boxRef = useRef(null);

  const loadTrending = useCallback(async () => {
    try {
      const data = await fetchTrending();
      setTrending(data.trending || []);
    } catch {
      /* trending is non-critical; ignore failures */
    }
  }, []);

  useEffect(() => {
    loadTrending();
  }, [loadTrending]);

  // Debounced suggestion fetch — avoids a backend call on every keystroke.
  const runSuggest = useCallback(
    (value, currentMode) => {
      if (!value.trim()) {
        setSuggestions([]);
        setMeta(null);
        setOpen(false);
        setLoading(false);
        return;
      }
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      fetchSuggestions(value, currentMode)
        .then((data) => {
          if (reqId !== reqIdRef.current) return; // stale response, drop it
          setSuggestions(data.suggestions || []);
          setMeta({ source: data.source, cacheNode: data.cacheNode, latencyMs: data.latencyMs });
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch((e) => {
          if (reqId !== reqIdRef.current) return;
          setError('Could not fetch suggestions. Is the backend running?');
          setSuggestions([]);
        })
        .finally(() => {
          if (reqId === reqIdRef.current) setLoading(false);
        });
    },
    []
  );

  const onChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSuggest(value, mode), DEBOUNCE_MS);
  };

  // Re-run suggestions when the ranking mode changes.
  const onModeChange = (newMode) => {
    setMode(newMode);
    if (query.trim()) runSuggest(query, newMode);
  };

  const doSearch = async (value) => {
    const q = (value ?? query).trim();
    if (!q) return;
    setOpen(false);
    setError(null);
    try {
      const result = await submitSearch(q);
      setSearchResult(result);
      setQuery(q);
      // The submitted query's popularity/recency just changed — refresh views.
      await loadTrending();
      runSuggest(q, mode);
    } catch {
      setError('Search submission failed. Is the backend running?');
    }
  };

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') doSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) doSearch(suggestions[activeIndex].query);
      else doSearch();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const handler = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Search Typeahead</h1>
        <p className="subtitle">
          120k queries · distributed cache (consistent hashing) · trending · batch writes
        </p>
      </header>

      <div className="mode-toggle" role="tablist" aria-label="Ranking mode">
        <button
          className={mode === 'count' ? 'active' : ''}
          onClick={() => onModeChange('count')}
        >
          Popularity (basic)
        </button>
        <button
          className={mode === 'recency' ? 'active' : ''}
          onClick={() => onModeChange('recency')}
        >
          Recency-aware (enhanced)
        </button>
      </div>

      <div className="search-box" ref={boxRef}>
        <div className="input-row">
          <input
            type="text"
            value={query}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length && setOpen(true)}
            placeholder="Search… (try 'iph', 'java', 'best')"
            aria-label="Search"
            autoComplete="off"
          />
          <button className="search-btn" onClick={() => doSearch()}>
            Search
          </button>
        </div>

        {loading && <div className="hint">Loading…</div>}
        {error && <div className="error">{error}</div>}

        {open && suggestions.length > 0 && (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.query}
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? 'active' : ''}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  doSearch(s.query);
                }}
              >
                <span className="s-query">{s.query}</span>
                <span className="s-meta">
                  {s.count.toLocaleString()} searches
                  {mode === 'recency' && s.recencyScore > 0 && (
                    <span className="s-trend"> · 🔥 {s.recencyScore}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {open && !loading && query.trim() && suggestions.length === 0 && !error && (
          <div className="hint">No matches for “{query}”.</div>
        )}
      </div>

      {meta && (
        <div className="cache-meta">
          served from <strong>{meta.source}</strong>
          {meta.cacheNode && <> · node <strong>{meta.cacheNode}</strong></>}
          {meta.latencyMs != null && <> · {meta.latencyMs} ms</>}
        </div>
      )}

      {searchResult && (
        <div className="search-result">
          <div className="badge">API response</div>
          <pre>{JSON.stringify(searchResult, null, 2)}</pre>
        </div>
      )}

      <section className="trending">
        <h2>🔥 Trending searches</h2>
        {trending.length === 0 ? (
          <p className="muted">No trending data yet — submit a few searches.</p>
        ) : (
          <ol>
            {trending.map((t) => (
              <li key={t.query}>
                <button className="link" onClick={() => doSearch(t.query)}>
                  {t.query}
                </button>
                <span className="muted"> · score {t.recencyScore}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
