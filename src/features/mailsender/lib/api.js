// Mail Sender no longer has its own login/token — every request rides on the
// same Salesvora session cookie the rest of the app already uses, so the only
// thing this client does is prefix requests and read the JSON body.
const BASE = '/api/mail';

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (res.status === 401) {
      return { error: 'Your Salesvora session has expired. Please log in again.' };
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`[MailAPI] Non-JSON response for ${path}:`, text.slice(0, 200));
      return { error: `Server error (${res.status}).` };
    }
  } catch (err) {
    console.error(`[MailAPI] Network error for ${path}:`, err.message);
    return { error: 'Cannot reach the server. Please try again.' };
  }
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
