async function jsonOrThrow(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(body?.error?.message || `request failed (HTTP ${res.status})`);
  }
  return body;
}

export const api = {
  listRepos: () => fetch('/api/repos').then(jsonOrThrow),

  cloneRepo: (url) =>
    fetch('/api/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(jsonOrThrow),

  uploadRepo: (file) => {
    const form = new FormData();
    form.append('zip', file);
    return fetch('/api/repos/upload', { method: 'POST', body: form }).then(jsonOrThrow);
  },

  deleteRepo: (id) => fetch(`/api/repos/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(jsonOrThrow),
};
