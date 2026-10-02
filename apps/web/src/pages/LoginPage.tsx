import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { errorMessage } from "../format";
import type { AuthConfig, GoogleResult } from "../types";
import { AuthLayout } from "../components/AuthLayout";

type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

function loadGoogleScript(): Promise<GoogleIdentityServices> {
  if (window.google) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in failed to load")));
    script.onerror = () => reject(new Error("Google sign-in failed to load"));
    document.head.appendChild(script);
  });
}

type Mode = "signin" | "signup";
type SignupDetails = { token: string; email: string; firstName: string; lastName: string };

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [signup, setSignup] = useState<SignupDetails | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then(setConfig).catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  // Both Google and the local "simulate Google" tool end here.
  const handleGoogle = (result: GoogleResult) => {
    setError(null);
    if (result.result === "signed-in") return onSignedIn();
    setSignup({ token: result.token, email: result.email, firstName: result.firstName, lastName: result.lastName });
    setMode("signup");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (requestSent) {
    body = (
      <div className="request-sent">
        <div className="request-icon" aria-hidden="true">✓</div>
        <h1>Request sent</h1>
        <p className="subtitle">
          An admin will review your access request and choose your role. You'll be able to sign in with your email and password once it's approved.
        </p>
        <button type="button" className="secondary-button" onClick={() => { setRequestSent(false); setSignup(null); switchMode("signin"); }}>
          Back to sign in
        </button>
      </div>
    );
  } else if (signup) {
    body = (
      <SignupDetailsForm
        details={signup}
        minPasswordLength={config?.minPasswordLength ?? 8}
        busy={busy}
        onCancel={() => setSignup(null)}
        onSubmit={(values) =>
          run(async () => {
            const result = await api.signup({ token: signup.token, ...values });
            if (result.result === "signed-in") onSignedIn();
            else setRequestSent(true);
          })
        }
      />
    );
  } else {
    body = (
      <>
        <div className="auth-heading">
          <h1>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="subtitle">{mode === "signin" ? "Sign in to continue to your workspace." : "Request access with your Google account."}</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button>
        </div>

        {mode === "signin" ? (
          <>
            <SignInForm busy={busy} onSubmit={(email, password) => run(async () => handleGoogle(await api.login(email, password)))} />
            <div className="auth-divider"><span>or</span></div>
            <GoogleButton clientId={config?.googleClientId ?? null} text="continue_with" onResult={handleGoogle} onError={setError} key="signin" />
          </>
        ) : (
          <div className="signup-start">
            <ol className="signup-steps">
              <li><span>1</span><div><strong>Continue with Google</strong><small>We take your name and email from your Google account.</small></div></li>
              <li><span>2</span><div><strong>Confirm your details</strong><small>Check your name and choose a password.</small></div></li>
              <li><span>3</span><div><strong>Get approved</strong><small>An admin reviews your request and sets your role.</small></div></li>
            </ol>
            <GoogleButton clientId={config?.googleClientId ?? null} text="signup_with" onResult={handleGoogle} onError={setError} key="signup" />
          </div>
        )}
      </>
    );
  }

  return (
    <AuthLayout>
      {error && <p className="login-error" role="alert">{error}</p>}
      {body}
      {config?.devLogin && !requestSent && <DevTools config={config} busy={busy} onGoogle={handleGoogle} run={run} />}
    </AuthLayout>
  );
}

function SignInForm({ busy, onSubmit }: { busy: boolean; onSubmit: (email: string, password: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(email.trim(), password);
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>Email</span>
        <div className="input-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@gmail.com" />
        </div>
      </label>
      <label>
        <span>Password</span>
        <div className="input-icon password-field">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
          <input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
          <button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
        </div>
      </label>
      <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="auth-hint">Forgot your password? Ask an admin to reset it. You'll get a temporary one and choose your own after signing in.</p>
    </form>
  );
}

function SignupDetailsForm({
  details,
  minPasswordLength,
  busy,
  onCancel,
  onSubmit,
}: {
  details: SignupDetails;
  minPasswordLength: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { firstName: string; lastName: string; password: string }) => void;
}) {
  const [firstName, setFirstName] = useState(details.firstName);
  const [lastName, setLastName] = useState(details.lastName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return;
    onSubmit({ firstName: firstName.trim(), lastName: lastName.trim(), password });
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <h1>Set up your profile</h1>
        <p className="subtitle">Check your name, then choose a password for signing in with your email.</p>
      </div>
      <div className="name-row">
        <label>
          <span>First name</span>
          <input required maxLength={60} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label>
          <span>Last name</span>
          <input required maxLength={60} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
        </label>
      </div>
      <label>
        <span>Email <em>from Google</em></span>
        <input value={details.email} disabled />
      </label>
      <label>
        <span>Password</span>
        <input type="password" autoComplete="new-password" required minLength={minPasswordLength} value={password} onChange={(event) => setPassword(event.target.value)} />
        <small>At least {minPasswordLength} characters.</small>
      </label>
      <label>
        <span>Confirm password</span>
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} aria-invalid={mismatch} />
        {mismatch && <small className="form-error">Passwords don't match.</small>}
      </label>
      <button type="submit" className="auth-submit" disabled={busy || mismatch}>{busy ? "Sending…" : "Request access"}</button>
      <button type="button" className="text-button auth-back" onClick={onCancel}>Use a different Google account</button>
    </form>
  );
}

function GoogleButton({
  clientId,
  text,
  onResult,
  onError,
}: {
  clientId: string | null;
  text: "continue_with" | "signup_with";
  onResult: (result: GoogleResult) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onResult, onError });
  handlers.current = { onResult, onError };

  useEffect(() => {
    if (!clientId || !container.current) return;
    const element = container.current;
    loadGoogleScript()
      .then((google) => {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) =>
            api.continueWithGoogle(credential).then(handlers.current.onResult).catch((cause: unknown) => handlers.current.onError(errorMessage(cause))),
        });
        // Google's button has a fixed width (max 400); match the card's form width.
        const width = Math.max(200, Math.min(400, element.clientWidth || 320));
        google.accounts.id.renderButton(element, { theme: "outline", size: "large", shape: "rectangular", logo_alignment: "center", width, text });
      })
      .catch((cause: unknown) => handlers.current.onError(errorMessage(cause)));
  }, [clientId, text]);

  if (!clientId) {
    return (
      <p className="google-missing">
        Google sign-in will appear here once it's connected (an admin adds <code>GOOGLE_CLIENT_ID</code>).
      </p>
    );
  }
  return <div className="google-button" ref={container} />;
}

// Only with DEV_LOGIN: switch between existing users and pretend to be Google, for testing without it.
function DevTools({
  config,
  busy,
  onGoogle,
  run,
}: {
  config: AuthConfig;
  busy: boolean;
  onGoogle: (result: GoogleResult) => void;
  run: (action: () => Promise<void>) => void;
}) {
  const [userEmail, setUserEmail] = useState(config.devUsers?.[0]?.email ?? "");
  const [fake, setFake] = useState({ email: "", firstName: "", lastName: "" });

  return (
    <details className="dev-tools">
      <summary>Local testing tools</summary>
      <div className="dev-tools-body">
        <p className="dev-tools-note">Only shown while <code>DEV_LOGIN=true</code>. Turn it off in <code>.env</code> for real use.</p>
        <form
          className="dev-row"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => onGoogle(await api.devLogin(userEmail)));
          }}
        >
          <select value={userEmail} onChange={(event) => setUserEmail(event.target.value)} aria-label="User to sign in as">
            {config.devUsers?.map((user) => (
              <option key={user.email} value={user.email}>{user.name} · {user.role.name}</option>
            ))}
          </select>
          <button type="submit" className="secondary-button" disabled={busy || !userEmail}>Sign in as</button>
        </form>
        <form
          className="dev-fake-google"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => onGoogle(await api.devGoogle(fake)));
          }}
        >
          <span>Simulate “Continue with Google”</span>
          <input type="email" required placeholder="someone@gmail.com" value={fake.email} onChange={(event) => setFake({ ...fake, email: event.target.value })} aria-label="Google email" />
          <div className="dev-row">
            <input placeholder="First name" value={fake.firstName} onChange={(event) => setFake({ ...fake, firstName: event.target.value })} aria-label="Google first name" />
            <input placeholder="Last name" value={fake.lastName} onChange={(event) => setFake({ ...fake, lastName: event.target.value })} aria-label="Google last name" />
          </div>
          <button type="submit" className="secondary-button" disabled={busy}>Continue as this Google account</button>
        </form>
      </div>
    </details>
  );
}
