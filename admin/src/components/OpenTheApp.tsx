import { TEAM_APP_URL } from '../auth/finishSignIn';
import { useT } from '../i18n/useT';

/** Shown to staff who signed in here: their 4VD is the app, not the dashboard. */
export function OpenTheApp() {
  const t = useT();
  return (
    <>
      <p className="form-success" role="status">
        {t.teamApp.ready}
      </p>
      <a className="button button--primary button--wide" href={TEAM_APP_URL}>
        {t.teamApp.open}
      </a>
      <p className="field-hint">{t.teamApp.homeScreen}</p>
    </>
  );
}
