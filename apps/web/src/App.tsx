import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, SESSION_EXPIRED_EVENT, api } from "./api";
import { Avatar } from "./components/Avatar";
import { NotificationBell } from "./components/NotificationBell";
import { TaskSheet } from "./components/TaskSheet";
import { errorMessage, hasPermission } from "./format";
import { AccessPage } from "./pages/AccessPage";
import { ChoosePasswordPage } from "./pages/ChoosePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { ProfilePage } from "./pages/ProfilePage";
import { navigate, useRoute } from "./router";
import { PERMISSIONS, type Meta, type Profile } from "./types";
import { Brand } from "./components/Logo";
import { NavIcon } from "./components/NavIcon";

type NavItem = { page: string; label: string; icon: string; permission?: string };

const navItems: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: "dashboard" },
  { page: "tasks", label: "Task sheet", icon: "tasks" },
  { page: "pos", label: "Partner Orgs (POs)", icon: "pos", permission: PERMISSIONS.poManage },
  { page: "access", label: "Access management", icon: "access", permission: PERMISSIONS.accessManage },
];

// Remembered per browser; storage can be unavailable (private windows), so it's best effort.
const SIDEBAR_KEY = "btrack.sidebar";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}
function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Not remembered; fine.
  }
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const route = useRoute();

  const toggleSidebar = () =>
    setCollapsed((current) => {
      saveCollapsed(!current);
      return !current;
    });

  const loadSession = useCallback(async () => {
    try {
      const me = await api.me();
      setProfile(me);
      // The rest of the API stays closed until a reset password is replaced.
      setMeta(me.mustChangePassword ? null : await api.meta());
      setLoadError(null);
    } catch (error) {
      setProfile(null);
      setMeta(null);
      if (!(error instanceof ApiError && error.status === 401)) setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const onExpired = () => {
      setProfile(null);
      setMeta(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setProfile(null);
    setMeta(null);
    navigate("dashboard");
  };

  const refreshMeta = useCallback(() => {
    api.meta().then(setMeta).catch(() => undefined);
  }, []);

  if (profile === undefined) return <p className="loading page-loading">Loading…</p>;
  if (profile === null) {
    return (
      <>
        {loadError && <p className="login-error floating" role="alert">Can't reach the API: {loadError}</p>}
        <LoginPage onSignedIn={loadSession} />
      </>
    );
  }

  if (profile.mustChangePassword) return <ChoosePasswordPage profile={profile} onDone={loadSession} onLogout={logout} />;

  const permissions = profile.permissions;
  const visibleNav = navItems.filter((item) => !item.permission || hasPermission(permissions, item.permission));
  const page = visibleNav.some((item) => item.page === route.page) || route.page === "profile" ? route.page : "dashboard";
  const pageTitle = page === "profile" ? "My profile" : navItems.find((item) => item.page === page)?.label;

  return (
    <main className={`workspace ${collapsed ? "nav-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#/dashboard" aria-label="B-Track home" title={collapsed ? "B-Track" : undefined}>
          <Brand size={34} />
        </a>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <NavIcon name="collapse" />
        </button>

        <p className="nav-label">WORKSPACE</p>
        <nav className="navigation">
          {visibleNav.map((item) => (
            <a
              key={item.page}
              className={`nav-item ${page === item.page ? "active" : ""}`}
              href={`#/${item.page}`}
              title={collapsed ? item.label : undefined}
              aria-current={page === item.page ? "page" : undefined}
            >
              <NavIcon name={item.icon} />
              <span className="nav-text">{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <a className="sidebar-profile" href="#/profile" title={collapsed ? `${profile.name} · ${profile.role.name}` : undefined}>
            <Avatar name={profile.name} url={profile.avatarUrl} size={34} />
            <span className="profile-copy">
              <strong>{profile.name}</strong>
              <span>{profile.role.name}</span>
            </span>
          </a>
          <button type="button" className="logout-icon" onClick={logout} title="Log out" aria-label="Log out"><NavIcon name="logout" /></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <NotificationBell />
            <UserMenu profile={profile} onLogout={logout} />
          </div>
        </header>

        <div className="content">
          {!meta && <p className="loading">Loading workspace…</p>}
          {meta && page === "dashboard" && <DashboardPage profile={profile} />}
          {meta && page === "tasks" && (
            <TaskSheet meta={meta} profile={profile} openTaskId={route.params.get("open")} onMetaChanged={refreshMeta} />
          )}
          {meta && page === "pos" && <PosPage onChanged={refreshMeta} />}
          {meta && page === "access" && <AccessPage currentUserId={profile.id} onChanged={loadSession} />}
          {meta && page === "profile" && <ProfilePage profile={profile} onUpdated={setProfile} onLogout={logout} />}
        </div>
      </section>
    </main>
  );
}

function UserMenu({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="menu-anchor" ref={menu}>
      <button type="button" className="avatar-button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        <Avatar name={profile.name} url={profile.avatarUrl} size={30} />
      </button>
      {open && (
        <div className="dropdown user-dropdown" role="menu">
          <div className="dropdown-head">
            <strong>{profile.name}</strong>
            <span>{profile.email}</span>
            <span className="role-chip">{profile.role.name}</span>
          </div>
          <a role="menuitem" className="dropdown-item" href="#/profile" onClick={() => setOpen(false)}>My profile</a>
          <button role="menuitem" type="button" className="dropdown-item danger" onClick={onLogout}>Log out</button>
        </div>
      )}
    </div>
  );
}
