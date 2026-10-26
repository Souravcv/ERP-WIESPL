// WIESPL CRM service worker: makes the CRM installable on phones ("Add to home screen").
// It keeps no offline copies: every request goes to the server, so attendance is never recorded from a cached page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
