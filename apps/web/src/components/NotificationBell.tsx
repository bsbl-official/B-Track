import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../format";
import { navigate } from "../router";
import type { Notification, Notifications } from "../types";

const POLL_MS = 30_000;

export function NotificationBell() {
  const [data, setData] = useState<Notifications>({ items: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api.notifications().then(setData).catch(() => undefined);
  }, []);

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
            {data.unreadCount > 0 && (
              <button type="button" className="text-button" onClick={markAllRead}>Mark all as read</button>
            )}
          </div>
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
