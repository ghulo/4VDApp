import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { LogoMark } from "../components/LogoMark";
import { ThemeSwitch } from "../theme/ThemeSwitch";
import { errorMessage } from "../utils/errors";

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (state.status === "signedIn") return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login">
      <section className="login__story" aria-label="4VD">
        <p className="login__mark">
          <LogoMark size={48} />
          4VD
        </p>
        <p className="login__headline">
          Your shop, your stock and your team in one place.
        </p>
        <p className="login__small-print">
          4VD is named for the four Dacaj brothers.
        </p>
      </section>
      <div className="login__side">
        <form className="login__card" onSubmit={handleSubmit} noValidate>
          <h1 className="login__title">Log in</h1>
          <p className="login__subtitle">
            Use the email your account was set up with.
          </p>

          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="button button--primary button--wide"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Logging in…" : "Log in"}
          </button>
          <ThemeSwitch className="login__theme" />
        </form>
      </div>
    </div>
  );
}
