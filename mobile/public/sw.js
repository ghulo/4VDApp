// Service worker for the 4VD app in a browser or on an iPhone Home Screen:
// shows push alerts from the server and opens the app when one is tapped.

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(payload.title || '4VD', {
      body: payload.body || '',
      icon: '/favicon.ico',
      // The same alert replaces itself rather than stacking.
      tag: payload.data ? '4vd-' + payload.data.notificationId : undefined,
      data: payload.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});
