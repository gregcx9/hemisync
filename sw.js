// Service worker retired: this device purges cache storage on reboot,
// which left half-broken caches causing blank launches. This stub cleans up
// any previous installation and unregisters itself.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url)); // reload cleanly without SW
    })()
  );
});
