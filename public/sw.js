// Beshara OnSite: shows new-message notifications and opens the chat when tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const url = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil(
    self.registration.showNotification(data.title || "Beshara OnSite", {
      body: data.body || "You have a new message.",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/apple-icon.png",
      badge: "/icon.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if ("focus" in w) {
          if ("navigate" in w) await w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
