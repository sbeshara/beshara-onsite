"use client";

import { useEffect } from "react";

// Keeps the notification worker installed so pushes can arrive while OnSite is closed.
export default function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
