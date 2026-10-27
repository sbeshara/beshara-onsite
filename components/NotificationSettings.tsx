"use client";

import { useEffect, useState } from "react";
import { pushState, turnOffPush, turnOnPush, type PushState } from "@/lib/push-client";
import { createClient } from "@/lib/supabase/client";

type Props = { userId: string; email: boolean; push: boolean };

export default function NotificationSettings({ userId, email, push }: Props) {
  const [emailOn, setEmailOn] = useState(email);
  const [pushOn, setPushOn] = useState(push);
  const [device, setDevice] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    pushState().then(setDevice);
  }, []);

  async function save(field: "email_notifications" | "push_notifications", value: boolean) {
    setMsg({});
    const { error } = await createClient().from("profiles").update({ [field]: value }).eq("id", userId);
    if (error) setMsg({ error: "Couldn't save that setting. Try again." });
  }

  async function deviceOn() {
    setBusy(true);
    setMsg({});
    try {
      const next = await turnOnPush();
      setDevice(next);
      if (next === "on") {
        if (!pushOn) {
          setPushOn(true);
          await save("push_notifications", true);
        }
        setMsg({ ok: "Notifications are on for this device." });
      } else if (next === "blocked") {
        setMsg({ error: "Notifications are blocked for OnSite in this browser's settings. Allow them there, then try again." });
      }
    } catch {
      setMsg({ error: "Couldn't turn on notifications on this device. Try again." });
    }
    setBusy(false);
  }

  async function deviceOff() {
    setBusy(true);
    setDevice(await turnOffPush());
    setMsg({ ok: "Notifications are off for this device." });
    setBusy(false);
  }

  async function test() {
    setMsg({});
    const res = await fetch("/api/push/test", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setMsg(res?.sent ? { ok: "Test sent. It should pop up in a few seconds." } : { error: "No devices are set up for notifications yet." });
  }

  return (
    <section className="form" aria-labelledby="notif-h">
      <h2 id="notif-h" className="sec-title">Notifications</h2>
      <label className="opt">
        <input type="checkbox" checked={emailOn} onChange={(e) => { setEmailOn(e.target.checked); save("email_notifications", e.target.checked); }} />
        <span>
          <b>Email me about new messages</b>
          <small>One email listing messages you haven&apos;t read in OnSite for 5 minutes, so you&apos;re not flooded while you&apos;re active.</small>
        </span>
      </label>
      <label className="opt">
        <input type="checkbox" checked={pushOn} onChange={(e) => { setPushOn(e.target.checked); save("push_notifications", e.target.checked); }} />
        <span>
          <b>Phone and computer notifications</b>
          <small>A pop-up the moment someone posts, on each device you turn on below.</small>
        </span>
      </label>
      <div className="box" style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
        <b>This device</b>
        {device === null && <span className="upl">Checking…</span>}
        {device === "on" && (
          <>
            <span className="upl">Notifications are on for this device.</span>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn ghost" onClick={test}>Send a test</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={deviceOff}>Turn off on this device</button>
            </div>
          </>
        )}
        {device === "off" && (
          <>
            <span className="upl">Get a pop-up here when there&apos;s a new message.</span>
            <div><button type="button" className="btn" disabled={busy} onClick={deviceOn}>Turn on notifications</button></div>
          </>
        )}
        {device === "blocked" && <span className="upl">Notifications are blocked for OnSite in this browser. Allow them in the browser&apos;s site settings, then reload this page.</span>}
        {device === "ios-needs-home-screen" && (
          <span className="upl">
            On iPhone and iPad, first add OnSite to your home screen: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. Open OnSite from the new icon, come back here, and turn on notifications.
          </span>
        )}
        {device === "unsupported" && <span className="upl">This browser doesn&apos;t support notifications. Email notifications still work.</span>}
      </div>
      {msg.error && <p className="err">{msg.error}</p>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
    </section>
  );
}
