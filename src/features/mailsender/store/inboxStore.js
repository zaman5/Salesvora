// Tiny pub/sub store for inbox unread count.
// Inbox.jsx publishes; App.jsx subscribes.
let _count = 0;
const _listeners = new Set();

export function setUnreadCount(n) {
  if (_count === n) return;
  _count = n;
  _listeners.forEach(fn => fn(n));
}

/** Alias used by Inbox.jsx */
export const publishUnread = setUnreadCount;

export function subscribeUnread(fn) {
  _listeners.add(fn);
  fn(_count); // emit current value immediately
  return () => _listeners.delete(fn); // returns unsubscribe
}

