import { Fragment, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { errorMessage, timeAgo } from "../format";
import { navigate, useRoute } from "../router";
import type { AccessData, AccessRole, AccessUser, PermissionInfo } from "../types";

type Tab = "requests" | "users" | "roles";
type Access = { roleId: string; grantedPermissions: string[]; revokedPermissions: string[] };
type Issued = { name: string; email: string; password: string };

export function AccessPage({ currentUserId, onChanged }: { currentUserId: string; onChanged: () => void }) {
  const route = useRoute();
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ email: "", firstName: "", lastName: "", roleId: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Shown once after a reset; it isn't stored anywhere the admin can see it again.
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = () => api.access().then(setData).catch((cause: unknown) => setError(errorMessage(cause)));
  useEffect(() => {
    load();
  }, []);

  const pending = data?.users.filter((user) => user.status === "PENDING") ?? [];
  const declined = data?.users.filter((user) => user.status === "REJECTED") ?? [];
  const approved = data?.users.filter((user) => user.status === "APPROVED") ?? [];
  const requestedTab = route.params.get("tab") as Tab | null;
  const tab: Tab = requestedTab ?? (pending.length > 0 ? "requests" : "users");
  const setTab = (next: Tab) => navigate("access", { tab: next });

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
      // The signed-in admin's own permissions may have changed.
      onChanged();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  };

  const togglePermission = (role: AccessRole, key: string) => {
    const permissions = role.permissions.includes(key)
      ? role.permissions.filter((permission) => permission !== key)
      : [...role.permissions, key];
    run(() => api.updateRole(role.id, { permissions }));
  };

  const addRole = () => {
    const name = window.prompt("New role name")?.trim();
    if (!name) return;
    run(() => api.createRole({ name, description: null, permissions: ["task.create", "comment.create"], isAssignable: true, canTest: false, isDefault: false }));
  };

  const renameRole = (role: AccessRole) => {
    const name = window.prompt("Rename role", role.name)?.trim();
    if (!name || name === role.name) return;
    run(() => api.updateRole(role.id, { name }));
  };

  const deleteRole = (role: AccessRole) => {
    if (!window.confirm(`Delete the "${role.name}" role?`)) return;
    run(() => api.deleteRole(role.id));
  };

  const resetPassword = (user: AccessUser) => {
    const confirmation = user.hasPassword
      ? `Reset ${user.name}'s password?\n\nTheir current password stops working and they're signed out everywhere. You'll get a temporary password to give them.`
      : `Give ${user.name} a temporary password?\n\nThey can then sign in with ${user.email} and this password instead of Google.`;
    if (!window.confirm(confirmation)) return;
    setIssued(null);
    run(async () => {
      const { temporaryPassword } = await api.resetPassword(user.id);
      setIssued({ name: user.name, email: user.email, password: temporaryPassword });
    });
  };

  const addUser = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      await api.createUser(newUser);
      setNewUser({ email: "", firstName: "", lastName: "", roleId: "" });
    });
  };

  if (!data) return error ? <p className="load-error" role="alert">{error}</p> : <p className="loading">Loading…</p>;

  const groups = [...new Set(data.permissions.map((permission) => permission.group))];

  return (
    <div className="admin-page">
      <div className="sheet-heading">
        <div>
          <h1>Access management</h1>
          <p className="subtitle">Approve sign-up requests, choose each person's role and access, and decide what each role can do.</p>
        </div>
      </div>

      <div className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "requests"} className={`view-tab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>
          Requests <span className={`view-count ${pending.length ? "attention" : ""}`}>{pending.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "users"} className={`view-tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>
          Users <span className="view-count">{approved.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "roles"} className={`view-tab ${tab === "roles" ? "active" : ""}`} onClick={() => setTab("roles")}>
          Roles &amp; permissions <span className="view-count">{data.roles.length}</span>
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {tab === "requests" && (
        <div className="requests">
          {pending.length === 0 && (
            <div className="panel-card empty-requests">
              <strong>No requests waiting</strong>
              <span>When someone signs up with Google, their request appears here and you get a notification.</span>
            </div>
          )}
          {pending.map((user) => (
            <RequestCard
              key={user.id}
              user={user}
              data={data}
              onApprove={(access) => run(() => api.updateUser(user.id, { ...access, status: "APPROVED" }))}
              onDecline={() => {
                if (window.confirm(`Decline ${user.name}'s request?`)) run(() => api.updateUser(user.id, { status: "REJECTED" }));
              }}
            />
          ))}
          {declined.length > 0 && (
            <div className="panel-card table-card declined">
              <h2>Declined</h2>
              <table className="plain-table">
                <tbody>
                  {declined.map((user) => (
                    <tr key={user.id}>
                      <td><UserCell user={user} /></td>
                      <td className="muted-cell">Requested {timeAgo(user.createdAt)}</td>
                      <td className="actions-cell">
                        <button type="button" className="text-button" onClick={() => run(() => api.updateUser(user.id, { status: "APPROVED" }))}>
                          Approve instead
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="panel-card table-card">
          <div className="sheet-scroll matrix-scroll">
            <table className="plain-table matrix">
              <thead>
                <tr>
                  <th className="matrix-label">Permission</th>
                  {data.roles.map((role) => (
                    <th key={role.id} className="matrix-role">
                      <button type="button" className="role-name" onClick={() => renameRole(role)} title="Rename">{role.name}</button>
                      <span className="role-users">{role._count.users} {role._count.users === 1 ? "user" : "users"}</span>
                      {role._count.users === 0 && !role.isDefault && (
                        <button type="button" className="text-button danger-text" onClick={() => deleteRole(role)}>Delete</button>
                      )}
                    </th>
                  ))}
                  <th className="matrix-add">
                    <button type="button" className="small-primary" onClick={addRole}>＋ Role</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group}>
                    <tr className="matrix-group"><td colSpan={data.roles.length + 2}>{group}</td></tr>
                    {data.permissions
                      .filter((permission) => permission.group === group)
                      .map((permission) => (
                        <tr key={permission.key}>
                          <td className="matrix-label">
                            <strong>{permission.label}</strong>
                            <span>{permission.description}</span>
                          </td>
                          {data.roles.map((role) => (
                            <td key={role.id} className="matrix-cell">
                              <input
                                type="checkbox"
                                checked={role.permissions.includes(permission.key)}
                                onChange={() => togglePermission(role, permission.key)}
                                aria-label={`${role.name}: ${permission.label}`}
                              />
                            </td>
                          ))}
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="matrix-group"><td colSpan={data.roles.length + 2}>Role settings</td></tr>
                <tr>
                  <td className="matrix-label">
                    <strong>Can be assigned tasks</strong>
                    <span>People with this role appear in “assign to” lists.</span>
                  </td>
                  {data.roles.map((role) => (
                    <td key={role.id} className="matrix-cell">
                      <input type="checkbox" checked={role.isAssignable} onChange={() => run(() => api.updateRole(role.id, { isAssignable: !role.isAssignable }))} aria-label={`${role.name}: can be assigned tasks`} />
                    </td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td className="matrix-label">
                    <strong>Can test tasks</strong>
                    <span>People with this role appear in “Tested by” lists.</span>
                  </td>
                  {data.roles.map((role) => (
                    <td key={role.id} className="matrix-cell">
                      <input type="checkbox" checked={role.canTest} onChange={() => run(() => api.updateRole(role.id, { canTest: !role.canTest }))} aria-label={`${role.name}: can test tasks`} />
                    </td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td className="matrix-label">
                    <strong>Default for new users</strong>
                    <span>Role given to someone signing in with Google for the first time.</span>
                  </td>
                  {data.roles.map((role) => (
                    <td key={role.id} className="matrix-cell">
                      <input type="radio" name="default-role" checked={role.isDefault} onChange={() => run(() => api.updateRole(role.id, { isDefault: true }))} aria-label={`${role.name}: default for new users`} />
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "users" && (
        <>
          <form className="inline-form" onSubmit={addUser}>
            <input type="email" required placeholder="name@company.com" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} aria-label="Email" />
            <input required placeholder="First name" value={newUser.firstName} onChange={(event) => setNewUser({ ...newUser, firstName: event.target.value })} aria-label="First name" />
            <input required placeholder="Last name" value={newUser.lastName} onChange={(event) => setNewUser({ ...newUser, lastName: event.target.value })} aria-label="Last name" />
            <select required value={newUser.roleId} onChange={(event) => setNewUser({ ...newUser, roleId: event.target.value })} aria-label="Role">
              <option value="">Role…</option>
              {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <button type="submit" className="small-primary">Add user</button>
            <span className="form-hint">Pre-approves them: they continue with Google using this email, then only set a password.</span>
          </form>

          {issued && <TemporaryPasswordNotice issued={issued} onClose={() => setIssued(null)} />}

          <div className="panel-card table-card">
            <table className="plain-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Access</th><th>Last sign-in</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {approved.map((user) => {
                  const customised = user.grantedPermissions.length + user.revokedPermissions.length > 0;
                  return (
                    <Fragment key={user.id}>
                      <tr className={user.isActive ? "" : "archived"}>
                        <td><UserCell user={user} isYou={user.id === currentUserId} /></td>
                        <td>
                          <select className="role-select" value={user.roleId} onChange={(event) => run(() => api.updateUser(user.id, { roleId: event.target.value }))} aria-label={`Role for ${user.name}`}>
                            {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                          </select>
                        </td>
                        <td>{customised ? <span className="state-chip custom">Customised</span> : <span className="muted-cell">As role</span>}</td>
                        <td className="muted-cell">
                          {user.lastLoginAt ? timeAgo(user.lastLoginAt) : user.hasPassword ? "Never" : "Not signed up yet"}
                          {user.mustChangePassword && <span className="state-chip custom reset-chip">Temporary password</span>}
                        </td>
                        <td><span className={`state-chip ${user.isActive ? "on" : "off"}`}>{user.isActive ? "Active" : "Deactivated"}</span></td>
                        <td className="actions-cell">
                          <button type="button" className="text-button" onClick={() => setEditingId(editingId === user.id ? null : user.id)}>
                            {editingId === user.id ? "Close" : "Edit"}
                          </button>
                          {user.id !== currentUserId && user.isActive && (
                            <button type="button" className="text-button" onClick={() => resetPassword(user)}>
                              Reset password
                            </button>
                          )}
                          {user.id !== currentUserId && (
                            <button type="button" className="text-button" onClick={() => run(() => api.updateUser(user.id, { isActive: !user.isActive }))}>
                              {user.isActive ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {editingId === user.id && (
                        <tr className="edit-row">
                          <td colSpan={6}>
                            <UserEditor
                              user={user}
                              data={data}
                              onSave={async (update) => {
                                if (await run(() => api.updateUser(user.id, update))) setEditingId(null);
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function TemporaryPasswordNotice({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="panel-card temp-password" role="status">
      <div>
        <strong>Temporary password for {issued.name}</strong>
        <span>Give it to them privately. They sign in with <b>{issued.email}</b> and this password, then must choose their own. It won't be shown again.</span>
      </div>
      <div className="temp-password-value">
        <code>{issued.password}</code>
        <button type="button" className="small-primary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="text-button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function UserCell({ user, isYou }: { user: AccessUser; isYou?: boolean }) {
  return (
    <div className="user-cell">
      <Avatar name={user.name} url={user.avatarUrl} size={30} />
      <span>
        <strong>{user.name}{isYou && <span className="you-chip">you</span>}</strong>
        <span>{user.email}</span>
      </span>
    </div>
  );
}

function effective(role: AccessRole | undefined, access: Access): Set<string> {
  const set = new Set([...(role?.permissions ?? []), ...access.grantedPermissions]);
  for (const key of access.revokedPermissions) set.delete(key);
  return set;
}

// Per-person feature access: starts from the role; each tick that differs from the role is kept
// as something added or removed for just this person.
function AccessEditor({
  permissions,
  role,
  access,
  onChange,
}: {
  permissions: PermissionInfo[];
  role: AccessRole | undefined;
  access: Access;
  onChange: (access: Access) => void;
}) {
  const current = effective(role, access);
  const toggle = (key: string) => {
    const fromRole = role?.permissions.includes(key) ?? false;
    const on = !current.has(key);
    const granted = access.grantedPermissions.filter((item) => item !== key);
    const revoked = access.revokedPermissions.filter((item) => item !== key);
    if (on && !fromRole) granted.push(key);
    if (!on && fromRole) revoked.push(key);
    onChange({ ...access, grantedPermissions: granted, revokedPermissions: revoked });
  };

  return (
    <div className="access-editor">
      {permissions.map((permission) => {
        const fromRole = role?.permissions.includes(permission.key) ?? false;
        const on = current.has(permission.key);
        return (
          <label key={permission.key} className={`access-option ${on !== fromRole ? "changed" : ""}`} title={permission.description}>
            <input type="checkbox" checked={on} onChange={() => toggle(permission.key)} />
            <span>
              <strong>{permission.label}</strong>
              {on !== fromRole && <em>{on ? "added for this person" : "removed for this person"}</em>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function RequestCard({
  user,
  data,
  onApprove,
  onDecline,
}: {
  user: AccessUser;
  data: AccessData;
  onApprove: (access: Access) => void;
  onDecline: () => void;
}) {
  const [access, setAccess] = useState<Access>({ roleId: user.roleId, grantedPermissions: [], revokedPermissions: [] });
  const role = data.roles.find((item) => item.id === access.roleId);

  return (
    <div className="panel-card request-card">
      <div className="request-head">
        <Avatar name={user.name} url={user.avatarUrl} size={44} />
        <div>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <span className="request-time">Requested {timeAgo(user.createdAt)}</span>
        </div>
      </div>
      <label className="request-role">
        <span>Role</span>
        <select value={access.roleId} onChange={(event) => setAccess({ roleId: event.target.value, grantedPermissions: [], revokedPermissions: [] })}>
          {data.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div>
        <span className="access-title">Feature access <em>starts from the role; adjust for this person if needed</em></span>
        <AccessEditor permissions={data.permissions} role={role} access={access} onChange={setAccess} />
      </div>
      <div className="request-actions">
        <button type="button" className="text-button danger-text" onClick={onDecline}>Decline</button>
        <button type="button" className="small-primary" onClick={() => onApprove(access)}>Approve as {role?.name ?? "…"}</button>
      </div>
    </div>
  );
}

function UserEditor({
  user,
  data,
  onSave,
}: {
  user: AccessUser;
  data: AccessData;
  onSave: (update: { firstName: string; lastName: string; email: string } & Access) => void;
}) {
  const [details, setDetails] = useState({ firstName: user.firstName ?? "", lastName: user.lastName ?? "", email: user.email });
  const [access, setAccess] = useState<Access>({
    roleId: user.roleId,
    grantedPermissions: user.grantedPermissions,
    revokedPermissions: user.revokedPermissions,
  });
  const role = data.roles.find((item) => item.id === access.roleId);

  return (
    <form
      className="user-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...details, ...access });
      }}
    >
      <div className="user-editor-fields">
        <label><span>First name</span><input required value={details.firstName} onChange={(event) => setDetails({ ...details, firstName: event.target.value })} /></label>
        <label><span>Last name</span><input required value={details.lastName} onChange={(event) => setDetails({ ...details, lastName: event.target.value })} /></label>
        <label className="wide">
          <span>Email</span>
          <input type="email" required value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} />
          {!user.hasPassword && <small>Not signed up yet. Put their real Gmail address here; they then continue with Google and only set a password.</small>}
        </label>
        <label>
          <span>Role</span>
          <select value={access.roleId} onChange={(event) => setAccess({ roleId: event.target.value, grantedPermissions: [], revokedPermissions: [] })}>
            {data.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      <span className="access-title">Feature access</span>
      <AccessEditor permissions={data.permissions} role={role} access={access} onChange={setAccess} />
      <div className="request-actions">
        <button type="submit" className="small-primary">Save changes</button>
      </div>
    </form>
  );
}
