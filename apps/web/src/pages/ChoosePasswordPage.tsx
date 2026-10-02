import { useState, type FormEvent } from "react";
import { api } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { errorMessage } from "../format";
import type { Profile } from "../types";

const MIN_PASSWORD_LENGTH = 8;

// Shown instead of the app after an admin resets someone's password.
export function ChoosePasswordPage({ profile, onDone, onLogout }: { profile: Profile; onDone: () => void; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword({ newPassword: password });
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-heading">
          <h1>Choose a new password</h1>
          <p className="subtitle">An admin reset your password. Choose your own to continue, {profile.firstName ?? profile.name}.</p>
        </div>
        <label>
          <span>Email</span>
          <input value={profile.email} disabled />
        </label>
        <label>
          <span>New password</span>
          <input type="password" autoComplete="new-password" required autoFocus minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} />
          <small>At least {MIN_PASSWORD_LENGTH} characters, different from the temporary one.</small>
        </label>
        <label>
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} aria-invalid={mismatch} />
          {mismatch && <small className="form-error">Passwords don't match.</small>}
        </label>
        {error && <small className="form-error" role="alert">{error}</small>}
        <button type="submit" className="auth-submit" disabled={busy || mismatch}>{busy ? "Saving…" : "Save and continue"}</button>
        <button type="button" className="text-button auth-back" onClick={onLogout}>Log out</button>
      </form>
    </AuthLayout>
  );
}
