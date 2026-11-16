"use client";

import { useEffect, useState } from "react";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Kind = "loading" | "installed" | "ios-safari" | "ios-other" | "android" | "mac-safari" | "desktop";

function detect(): Kind {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) return "installed";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (ios) {
    // Safari and Chrome on iPhone have Add to Home Screen; email apps' built-in browsers don't.
    const inApp = /GSA\/|FBAN|FBAV|Instagram|LinkedInApp|Outlook|; wv\)/.test(ua);
    return inApp ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "mac-safari";
  return "desktop";
}

// The iPhone Share icon, drawn so people recognize it.
const ShareIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PlusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

export default function InstallGuide({ welcome }: { welcome: boolean }) {
  const [kind, setKind] = useState<Kind>("loading");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setKind(detect());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Prompt);
    };
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setDone(true);
    setPrompt(null);
  }

  const continueLink = (
    <a className="linkbtn install-skip" href="/">
      {welcome ? "Skip for now and go to OnSite →" : "Continue to OnSite →"}
    </a>
  );

  return (
    <div className="auth-card install">
      <div className="install-app">
        <img src="/icon-192.png" alt="" width="64" height="64" />
        <div>
          <b>BB OnSite</b>
          <span>Beshara Builders</span>
        </div>
      </div>
      <h1>{welcome ? "You're All Set. Now Add the App" : "Get the OnSite App"}</h1>
      <p className="sub">Keep OnSite on your home screen like any other app. One tap opens your project, and you stay signed in.</p>

      {kind === "loading" && <p className="fine">One moment…</p>}

      {kind === "installed" && (
        <>
          <p className="ok">OnSite is already on this device. You&apos;re using it right now.</p>
          <a className="btn wide" href="/">Open OnSite</a>
        </>
      )}

      {done && kind !== "installed" && (
        <>
          <p className="ok" role="status">Done! Look for the green <b>BB OnSite</b> icon on your home screen or desktop.</p>
          <a className="btn wide" href="/">Continue to OnSite</a>
        </>
      )}

      {!done && prompt && kind !== "installed" && (
        <>
          <button type="button" className="btn wide install-btn" onClick={install}>
            Install OnSite
          </button>
          {continueLink}
        </>
      )}

      {!done && !prompt && kind === "ios-safari" && (
        <>
          <ol className="install-steps">
            <li>
              <span className="install-ic"><ShareIcon /></span>
              <span>Tap the <b>Share</b> button at the bottom of the screen (on iPad, at the top).</span>
            </li>
            <li>
              <span className="install-ic"><PlusIcon /></span>
              <span>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span>
            </li>
          </ol>
          <p className="fine">Then open <b>BB OnSite</b> from its new icon and sign in once. It stays signed in after that.</p>
          {continueLink}
        </>
      )}

      {!done && !prompt && kind === "ios-other" && (
        <>
          <p>This page opened inside another app. To add OnSite to your home screen, open it in <b>Safari</b>:</p>
          <ol className="install-steps">
            <li>
              <span className="install-ic">⋯</span>
              <span>Tap the menu or Share button here and choose <b>Open in Safari</b> (or copy the link below and paste it into Safari).</span>
            </li>
            <li>
              <span className="install-ic"><ShareIcon /></span>
              <span>In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</span>
            </li>
          </ol>
          <button
            type="button"
            className="btn ghost wide"
            onClick={() => navigator.clipboard?.writeText(`${location.origin}/install`).then(() => setCopied(true))}
          >
            {copied ? "Link Copied" : "Copy Link"}
          </button>
          {continueLink}
        </>
      )}

      {!done && !prompt && kind === "android" && (
        <>
          <ol className="install-steps">
            <li>
              <span className="install-ic">⋮</span>
              <span>Tap the <b>⋮</b> menu at the top right of Chrome.</span>
            </li>
            <li>
              <span className="install-ic"><PlusIcon /></span>
              <span>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</span>
            </li>
          </ol>
          {continueLink}
        </>
      )}

      {!done && !prompt && kind === "mac-safari" && (
        <>
          <ol className="install-steps">
            <li>
              <span className="install-ic"><ShareIcon /></span>
              <span>In the menu bar, click <b>File</b>, then <b>Add to Dock</b>.</span>
            </li>
            <li>
              <span className="install-ic"><PlusIcon /></span>
              <span>Click <b>Add</b>. OnSite opens in its own window from your Dock.</span>
            </li>
          </ol>
          {continueLink}
        </>
      )}

      {!done && !prompt && kind === "desktop" && (
        <>
          <ol className="install-steps">
            <li>
              <span className="install-ic"><PlusIcon /></span>
              <span>In Chrome or Edge, click the <b>install</b> icon at the right end of the address bar.</span>
            </li>
            <li>
              <span className="install-ic">⋮</span>
              <span>Don&apos;t see it? Open the <b>⋮</b> menu, then <b>Cast, save and share</b>, then <b>Install page as app</b>.</span>
            </li>
          </ol>
          {continueLink}
        </>
      )}
    </div>
  );
}
