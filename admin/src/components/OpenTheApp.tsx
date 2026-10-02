import { TEAM_APP_URL } from '../auth/finishSignIn';

/** Shown to staff who signed in here: their 4VD is the app, not the dashboard. */
export function OpenTheApp() {
  return (
    <>
      <p className="form-success" role="status">
        Your account is ready. 4VD for the team lives in the app.
      </p>
      <a className="button button--primary button--wide" href={TEAM_APP_URL}>
        Open the 4VD app
      </a>
      <p className="field-hint">On a phone, add it to your home screen so it opens like an app.</p>
    </>
  );
}
