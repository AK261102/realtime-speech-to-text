async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  health: () => request('/health'),
  list: ({ search = '', limit = 10, offset = 0 } = {}) =>
    request(`/transcriptions?${new URLSearchParams({ search, limit, offset })}`),
  create: (data) => request('/transcriptions', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/transcriptions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/transcriptions/${id}`, { method: 'DELETE' }),
};

export const LANGUAGE_OPTIONS = [
  { value: 'hi-en', label: 'Hindi + English (Hinglish)', short: 'Hinglish' },
  { value: 'auto', label: 'Auto detect (any language)', short: 'Auto' },
  { value: 'hi-IN', label: 'Hindi', short: 'Hindi' },
  { value: 'en-IN', label: 'English', short: 'English' },
];

export const languageLabel = (value) => LANGUAGE_OPTIONS.find((o) => o.value === value)?.label ?? value;

export function liveSocketUrl(language) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/transcribe?language=${encodeURIComponent(language)}`;
}
