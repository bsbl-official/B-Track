import { useState } from "react";
import { browserPermission, playChime, rememberNotificationsDeclined, requestBrowserPermission, shouldAskForNotifications } from "../sound";

/**
 * Asks once per sign-in (and per browser session) to turn on browser notifications, until the person
 * allows them; after that it never shows again. The browser's own prompt only opens from a click,
 * so this card's button opens it. If the browser has already blocked B-Track, it can't prompt any
 * more, so the card explains how to unblock it instead.
 */
export function NotifyPrompt() {
  const [visible, setVisible] = useState(shouldAskForNotifications);
  const [blocked, setBlocked] = useState(() => browserPermission() === "denied");

  if (!visible) return null;

  const dismiss = () => {
    rememberNotificationsDeclined();
    setVisible(false);
  };

  const turnOn = async () => {
    const result = await requestBrowserPermission();
    if (result === "granted") {
      setVisible(false);
      playChime();
      try {
        new window.Notification("B-Track", { body: "Notifications are on. You'll get an alert like this for new notifications.", icon: "/logo.svg", silent: true });
      } catch {
        // Allowed, but this browser shows nothing outside a service worker; the chime still works.
      }
    } else if (result === "denied") {
      setBlocked(true);
    } else {
      dismiss();
    }
  };

  return (
    <div className="notify-prompt" role="dialog" aria-labelledby="notify-prompt-title">
      <span className="notify-prompt-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
        </svg>
      </span>
      <div className="notify-prompt-body">
        <strong id="notify-prompt-title">{blocked ? "Notifications are blocked" : "Turn on notifications?"}</strong>
        {blocked ? (
          <p>
            This browser is blocking alerts from B-Track. To allow them, click the icon at the left of the address bar,
            set <b>Notifications</b> to <b>Allow</b>, then reload the page.
          </p>
        ) : (
          <p>Get an alert with a sound when a task is assigned to you, you're asked to test one, or anything else needs you.</p>
        )}
        <div className="notify-prompt-actions">
          {blocked ? (
            <button type="button" className="primary-button" onClick={dismiss}>Got it</button>
          ) : (
            <>
              <button type="button" className="primary-button" onClick={turnOn}>Turn on</button>
              <button type="button" className="text-button" onClick={dismiss}>Not now</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
