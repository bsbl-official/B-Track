// Alerts for new notifications: a browser (system) notification when the person has allowed them,
// and a chime synthesised with Web Audio, so there's no sound file to ship.
//
// Browsers only let a page make sound after the person has interacted with it (a click or a key),
// so the audio context is created and resumed on the first such gesture. Until then chimes are skipped,
// but a system notification still plays the operating system's own sound.

import type { Notification as AppNotification } from "./types";

const SOUND_KEY = "btrack.notify.sound";
const LAST_ALERT_KEY = "btrack.notify.lastAlert";
// Set for this browser session once the person has answered "Turn on notifications?" without allowing them.
const PROMPTED_KEY = "btrack.notify.prompted";

let context: AudioContext | null = null;

export function unlockAudio() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    // No Web Audio: chimes stay silent.
  }
}

if (typeof window !== "undefined") {
  for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    // Not remembered; fine.
  }
}

/** Two soft rising notes, about half a second. */
export function playChime() {
  if (!context) return;
  if (context.state === "suspended") void context.resume();
  const start = context.currentTime + 0.03;
  const notes: Array<[frequency: number, offset: number]> = [
    [880, 0],
    [1318.5, 0.14],
  ];
  for (const [frequency, offset] of notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const at = start + offset;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  }
}

// ---- Browser notification permission ----

export type BrowserPermission = "unsupported" | NotificationPermission;

export function browserPermission(): BrowserPermission {
  return typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported";
}

/** Shows the browser's own "Allow notifications?" prompt. Must run from a click. */
export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (browserPermission() === "unsupported") return "unsupported";
  unlockAudio();
  try {
    return await window.Notification.requestPermission();
  } catch {
    return browserPermission();
  }
}

/** Ask (again) unless notifications are on, or the person already said no in this browser session. */
export function shouldAskForNotifications(): boolean {
  const permission = browserPermission();
  if (permission === "unsupported" || permission === "granted") return false;
  try {
    return sessionStorage.getItem(PROMPTED_KEY) !== "1";
  } catch {
    return true;
  }
}

export function rememberNotificationsDeclined() {
  try {
    sessionStorage.setItem(PROMPTED_KEY, "1");
  } catch {
    // Asked again on the next page load; fine.
  }
}

/** A fresh sign-in asks again (if notifications still aren't allowed). */
export function resetNotificationPrompt() {
  try {
    sessionStorage.removeItem(PROMPTED_KEY);
  } catch {
    // Nothing to reset.
  }
}

// ---- Alerting ----

/**
 * Alerts for notifications that just arrived (newest first). With B-Track open in several tabs, only the
 * first tab to see them alerts: it records the newest id and the other tabs then stay quiet.
 */
export function alertNew(items: AppNotification[], onOpen: (item: AppNotification) => void) {
  if (items.length === 0) return;
  try {
    if (localStorage.getItem(LAST_ALERT_KEY) === items[0].id) return;
    localStorage.setItem(LAST_ALERT_KEY, items[0].id);
  } catch {
    // Can't share between tabs; alert anyway.
  }

  const sound = soundEnabled();
  // One sound per alert: our chime when the page may play audio, otherwise the system notification's own.
  const chime = sound && context?.state === "running";
  let shown = false;
  if (browserPermission() === "granted") {
    // A few at most, so a burst doesn't bury the screen.
    for (const item of items.slice(0, 3)) {
      try {
        const popup = new window.Notification("B-Track", {
          body: item.message,
          icon: "/logo.svg",
          tag: item.id,
          silent: !sound || chime,
        });
        popup.onclick = () => {
          window.focus();
          popup.close();
          onOpen(item);
        };
        shown = true;
      } catch {
        // Some browsers only allow notifications from a service worker; the chime still plays.
      }
    }
  }
  if (chime || (sound && !shown)) playChime();
}
