"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { pushState, turnOnPush, type PushState } from "@/lib/push-client";

const KEY = "onsite-notify-prompt-dismissed";

// A one-time nudge on the home screen to turn on notifications for this device.
export default function NotifyPrompt() {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {}
    if (dismissed) return;
    pushState().then((s) => {
      setState(s);
      setHidden(!(s === "off" || s === "ios-needs-home-screen"));
    });
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  }

  if (hidden || !state) return null;
  return (
    <div className="notify-card" role="region" aria-label="Notifications">
      <p>
        <b>Get notified about new messages.</b>{" "}
        {state === "ios-needs-home-screen" ? (
          <span className="upl">On iPhone, add OnSite to your home screen first (Share → Add to Home Screen), then turn on notifications in <Link href="/account" style={{ textDecoration: "underline" }}>Your account</Link>.</span>
        ) : (
          <span className="upl">See a pop-up on this device when someone posts.</span>
        )}
      </p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={dismiss}>Not now</button>
        {state === "off" && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const s = await turnOnPush().catch(() => "off" as PushState);
              if (s === "on" || s === "blocked") dismiss();
            }}
          >
            Turn on
          </button>
        )}
      </div>
    </div>
  );
}
