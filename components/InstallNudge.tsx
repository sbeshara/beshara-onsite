"use client";

import { useEffect, useState } from "react";

const KEY = "onsite-install-nudge-hidden";

// For clients on a phone browser (not the installed app): a slim bar offering
// to add OnSite to the home screen. Closing it hides it on this device.
export default function InstallNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const installed = window.matchMedia("(display-mode: standalone)").matches || nav.standalone;
    let hidden = false;
    try {
      hidden = localStorage.getItem(KEY) === "1";
    } catch {}
    setShow(!installed && !hidden && /iPhone|iPad|iPod|Android/.test(navigator.userAgent));
  }, []);
  if (!show) return null;
  return (
    <div className="install-nudge" role="note">
      <img src="/icon-192.png" alt="" />
      <span>Get OnSite on your home screen</span>
      <a className="btn" href="/install">Add</a>
      <button
        type="button"
        aria-label="Not now"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(KEY, "1");
          } catch {}
        }}
      >
        ×
      </button>
    </div>
  );
}
