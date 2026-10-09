// Service worker: shows push alerts from the 4VD server, even when the
// dashboard is closed, and opens the right page when one is clicked.

const PAGE_BY_TYPE = {
  low_stock: '/inventory?lowStock=true',
  out_of_stock: '/inventory?lowStock=true',
  approval: '/inbox',
  cash_difference: '/cash',
  daily_summary: '/report',
};

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(payload.title || '4VD', {
      body: payload.body || '',
      icon: '/favicon.svg',
      // Same notification id replaces rather than stacks.
      tag: payload.data ? `4vd-${payload.data.notificationId}` : undefined,
      data: payload.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = data.link || PAGE_BY_TYPE[data.type] || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) return open.focus().then(() => open.navigate(path));
      return self.clients.openWindow(path);
    }),
  );
});
