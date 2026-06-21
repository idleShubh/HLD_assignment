// Thin API client. Relative URLs work in dev (Vite proxy) and in the
// production build (served by the backend itself).

export async function fetchSuggestions(prefix, mode) {
  const url = `/suggest?q=${encodeURIComponent(prefix)}&mode=${mode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`suggest failed: ${res.status}`);
  return res.json();
}

export async function submitSearch(query) {
  const res = await fetch('/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json();
}

export async function fetchTrending() {
  const res = await fetch('/trending');
  if (!res.ok) throw new Error(`trending failed: ${res.status}`);
  return res.json();
}
