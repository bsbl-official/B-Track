import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../format";
import { navigate } from "../router";
import { alertNew, playChime, setSoundEnabled, soundEnabled } from "../sound";
import type { Notification, Notifications } from "../types";

const POLL_MS = 15_000;

// onWhatsNew opens the latest release notes; the panel always offers them at the top.
export function NotificationBell({ onWhatsNew, whatsNewDate }: { onWhatsNew: () => void; whatsNewDate: string }) {
  const [data, setData] = useState<Notifications>({ items: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const panel = useRef<HTMLDivElement>(null);
  // Ids already shown; null until the first load, whose notifications are old news and don't chime.
  const seen = useRef<Set<string> | null>(null);

  // Clicking a system notification opens it like a click in the panel does.
  const openRef = useRef<(notification: Notification) => void>(() => undefined);

  const refresh = useCallback(() => {
    api
      .notifications()
      .then((next) => {
        if (seen.current) {
          const fresh = next.items.filter((item) => !item.readAt && !seen.current!.has(item.id));
          alertNew(fresh, (item) => openRef.current(item));
        } else {
          seen.current = new Set();
        }
        for (const item of next.items) seen.current.add(item.id);
        setData(next);
      })
      .catch(() => undefined);
  }, []);

  const toggleSound = () => {
    const enabled = !sound;
    setSound(enabled);
    setSoundEnabled(enabled);
    if (enabled) playChime();
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openNotification = async (notification: Notification) => {
    setOpen(false);
    if (!notification.readAt) {
      await api.markNotificationRead(notification.id).catch(() => undefined);
      refresh();
    }
    if (notification.taskId) {
      navigate("tasks", { open: notification.taskId });
    } else if (notification.link) {
      window.location.hash = `#/${notification.link}`;
    }
  };

  openRef.current = openNotification;

  const markAllRead = async () => {
    await api.markAllNotificationsRead().catch(() => undefined);
    refresh();
  };

  return (
    <div className="menu-anchor" ref={panel}>
      <button
        type="button"
        className="bell-button"
        onClick={() => {
          setOpen((value) => !value);
          refresh();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications${data.unreadCount ? `, ${data.unreadCount} unread` : ""}`}
      >
        <span aria-hidden="true">🔔</span>
        {data.unreadCount > 0 && <span className="bell-badge">{data.unreadCount > 9 ? "9+" : data.unreadCount}</span>}
      </button>

      {open && (
        <div className="dropdown notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-head">
            <strong>Notifications</strong>
            <span className="notification-actions">
              <button
                type="button"
                className={`sound-toggle ${sound ? "on" : ""}`}
                onClick={toggleSound}
                aria-pressed={sound}
                title={sound ? "Sound on: a chime plays for new notifications. Click to mute." : "Sound off. Click to turn the chime on."}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
                  {sound ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5m0-5-5 5" />}
                </svg>
                {sound ? "Sound on" : "Sound off"}
              </button>
              {data.unreadCount > 0 && (
                <button type="button" className="text-button" onClick={markAllRead}>Mark all as read</button>
              )}
            </span>
          </div>
          <button
            type="button"
            className="whats-new-entry"
            onClick={() => {
              setOpen(false);
              onWhatsNew();
            }}
          >
            <span className="whats-new-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z" /><path d="M18.5 3.5v3M17 5h3" /></svg>
            </span>
            <span>
              <strong>What's new in B-Track</strong>
              <span>{whatsNewDate} · testing sign-off, alerts, tags and weekly tasks</span>
            </span>
            <svg className="whats-new-go" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
          </button>
          {data.items.length === 0 ? (
            <p className="notification-empty">You're all caught up.</p>
          ) : (
            <ul className="notification-list">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`notification-item ${item.readAt ? "" : "unread"}`} onClick={() => openNotification(item)}>
                    <span className="notification-dot" aria-hidden="true" />
                    <span>
                      <span className="notification-message">{item.message}</span>
                      <span className="notification-time">{timeAgo(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
