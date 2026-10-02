import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { errorMessage, formatDateTime } from "../format";
import type { Profile } from "../types";

type Message = { text: string; error?: boolean } | null;

export function ProfilePage({
  profile,
  onUpdated,
  onLogout,
}: {
  profile: Profile;
  onUpdated: (profile: Profile) => void;
  onLogout: () => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName ?? "");
  const [lastName, setLastName] = useState(profile.lastName ?? "");
  const [nameMessage, setNameMessage] = useState<Message>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState<Message>(null);

  const nameChanged = firstName.trim() !== (profile.firstName ?? "") || lastName.trim() !== (profile.lastName ?? "");
  const mismatch = passwords.confirm.length > 0 && passwords.confirm !== passwords.next;

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() });
      onUpdated(await api.me());
      setNameMessage({ text: "Saved" });
    } catch (cause) {
      setNameMessage({ text: errorMessage(cause), error: true });
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    try {
      await api.changePassword({ currentPassword: profile.hasPassword ? passwords.current : undefined, newPassword: passwords.next });
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordMessage({ text: "Password updated" });
      if (!profile.hasPassword) onUpdated(await api.me());
    } catch (cause) {
      setPasswordMessage({ text: errorMessage(cause), error: true });
    }
  };

  return (
    <div className="admin-page profile-page">
      <div className="panel-card profile-card">
        <div className="profile-header">
          <Avatar name={profile.name} url={profile.avatarUrl} size={72} />
          <div>
            <h1>{profile.name}</h1>
            <p className="subtitle">{profile.email}</p>
            <span className="role-chip">{profile.role.name}</span>
          </div>
        </div>

        <form className="profile-form" onSubmit={saveName}>
          <div className="name-row">
            <label>
              <span>First name</span>
              <input value={firstName} onChange={(event) => { setFirstName(event.target.value); setNameMessage(null); }} maxLength={60} required />
            </label>
            <label>
              <span>Last name</span>
              <input value={lastName} onChange={(event) => { setLastName(event.target.value); setNameMessage(null); }} maxLength={60} required />
            </label>
          </div>
          <label>
            <span>Email</span>
            <input value={profile.email} disabled />
            <small>{profile.googleLinked ? "Linked to your Google account." : "Ask an admin if this needs to change."}</small>
          </label>
          <label>
            <span>Role</span>
            <input value={profile.role.name} disabled />
            <small>Only an admin can change your role or access.</small>
          </label>
          <div className="profile-actions">
            {nameMessage && <span className={nameMessage.error ? "form-error" : "form-success"}>{nameMessage.text}</span>}
            <button type="submit" className="small-primary" disabled={!nameChanged || !firstName.trim() || !lastName.trim()}>Save</button>
          </div>
        </form>

        <form className="profile-form password-section" onSubmit={savePassword}>
          <h2>{profile.hasPassword ? "Change password" : "Set a password"}</h2>
          {!profile.hasPassword && <p className="subtitle">Set one to sign in with your email and password as well as Google.</p>}
          {profile.hasPassword && (
            <label>
              <span>Current password</span>
              <input type="password" autoComplete="current-password" required value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} />
            </label>
          )}
          <div className="name-row">
            <label>
              <span>New password</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} />
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" autoComplete="new-password" required value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} aria-invalid={mismatch} />
            </label>
          </div>
          <div className="profile-actions">
            {mismatch && <span className="form-error">Passwords don't match.</span>}
            {passwordMessage && !mismatch && <span className={passwordMessage.error ? "form-error" : "form-success"}>{passwordMessage.text}</span>}
            <button type="submit" className="small-primary" disabled={mismatch || !passwords.next}>{profile.hasPassword ? "Change password" : "Set password"}</button>
          </div>
        </form>

        <dl className="profile-facts">
          <div><dt>Member since</dt><dd>{formatDateTime(profile.createdAt)}</dd></div>
          <div><dt>Last sign-in</dt><dd>{profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : "—"}</dd></div>
        </dl>

        <button type="button" className="logout-button" onClick={onLogout}>⏻ Log out</button>
      </div>
    </div>
  );
}
