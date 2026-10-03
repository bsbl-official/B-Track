import type { ReactNode } from "react";
import { Brand } from "./Logo";

// Shared frame for the sign-in, sign-up and "choose a new password" pages:
// brand centred at the top on a graphite band, the card overlapping it.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-shell">
        <header className="auth-header">
          <Brand size={72} stacked />
          <p className="auth-tagline">Made for Benchmark: small fixes, big progress</p>
        </header>
        <section className="login-card">{children}</section>
        <footer className="auth-footer">B-Track · Internal workspace</footer>
      </div>
    </main>
  );
}
