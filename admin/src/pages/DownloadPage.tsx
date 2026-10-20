import { DeviceMobile, DownloadSimple, ShieldCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { TEAM_APP_URL } from '../auth/finishSignIn';
import { LogoMark } from '../components/LogoMark';
import { buttonClass } from '../components/ui';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useLanguage, useT } from '../i18n/useT';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { formatDate } from '../utils/format';

const REPO = 'ghulo/4VDApp';
const SETUP = '4VD-Setup.exe';
/** GitHub always serves the newest release's installer here, even when its details can't be read. */
const FALLBACK_URL = `https://github.com/${REPO}/releases/latest/download/${SETUP}`;

interface Release {
  version: string;
  publishedAt: string;
  size: number | null;
  url: string;
}

/** The newest Windows app release, from GitHub's public API (the same place the app updates from). */
async function latestRelease(): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = (await response.json()) as {
    tag_name: string;
    published_at: string;
    assets: Array<{ name: string; size: number; browser_download_url: string }>;
  };
  const setup = release.assets.find((asset) => asset.name === SETUP);
  return {
    version: release.tag_name.replace(/^v/, ''),
    publishedAt: release.published_at,
    size: setup?.size ?? null,
    url: setup?.browser_download_url ?? FALLBACK_URL,
  };
}

const megabytes = (bytes: number, language: string) =>
  new Intl.NumberFormat(language, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(bytes / 1_000_000);

/** 4vd.app/download: what the Windows app is, the installer, and how to install it. Open without signing in. */
export function DownloadPage() {
  const t = useT().download;
  const { language } = useLanguage();
  const release = useQuery({ queryKey: ['windows-release'], queryFn: latestRelease, staleTime: 10 * 60_000, retry: 1 });

  let meta = t.metaPlain;
  if (release.isPending) meta = t.metaLoading;
  else if (release.data) meta = release.data.size ? t.meta(release.data.version, megabytes(release.data.size, language)) : t.metaPlain;

  return (
    <div className="download">
      <header className="download__bar">
        <Link to="/" className="download__brand" translate="no">
          <LogoMark size={28} />
          4VD
        </Link>
        <Link to="/login" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          {t.signIn}
        </Link>
      </header>

      <main className="download__main">
        <section className="download__hero" aria-labelledby="download-title">
          <div className="download__intro">
            <p className="download__kicker">{t.kicker}</p>
            <h1 id="download-title" className="download__title">
              {t.title}
            </h1>
            <p className="download__lead">{t.lead}</p>
            <a href={release.data?.url ?? FALLBACK_URL} className={`${buttonClass({ variant: 'primary' })} download__button`} download>
              <DownloadSimple size={20} weight="bold" aria-hidden="true" />
              {t.button}
            </a>
            <p className="download__meta" aria-live="polite">
              {meta}
              {release.data && (
                <>
                  <br />
                  {t.released(formatDate(release.data.publishedAt))}
                </>
              )}
            </p>
            {release.isError && <p className="download__meta-error">{t.metaError}</p>}
          </div>

          <div className="card download__steps">
            <h2 className="card__title">{t.stepsTitle}</h2>
            <ol className="download__step-list">
              {t.steps.map((step, index) => (
                <li key={step.title} className="download__step">
                  <span className="download__step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>
                    <strong className="download__step-title">{step.title}</strong>
                    <span className="download__step-body">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="download__more">
          <section className="card download__warning" aria-labelledby="download-warning">
            <span className="icon-chip" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <h2 id="download-warning" className="card__title">
              {t.warning.title}
            </h2>
            <p className="download__text">{t.warning.body}</p>
            <p className="download__text">{t.warning.how}</p>
            <ol className="download__how">
              <li>{t.warning.first}</li>
              <li>{t.warning.second}</li>
            </ol>
            {/* A sketch of Windows' own box, so the two clicks are easy to find. */}
            <div className="smartscreen" aria-hidden="true">
              <p className="smartscreen__title">{t.warning.sketch.title}</p>
              <p className="smartscreen__text">{t.warning.sketch.text}</p>
              <p className="smartscreen__link">
                <span className="smartscreen__mark">1</span>
                {t.warning.sketch.moreInfo}
              </p>
              <p className="smartscreen__keys">
                <span className="smartscreen__key smartscreen__key--run">
                  <span className="smartscreen__mark">2</span>
                  {t.warning.sketch.run}
                </span>
                <span className="smartscreen__key">{t.warning.sketch.dontRun}</span>
              </p>
            </div>
          </section>

          <section className="card download__phone" aria-labelledby="download-phone">
            <span className="icon-chip" aria-hidden="true">
              <DeviceMobile size={20} />
            </span>
            <h2 id="download-phone" className="card__title">
              {t.phone.title}
            </h2>
            <p className="download__text">{t.phone.body}</p>
            <a href={TEAM_APP_URL} className={buttonClass({ variant: 'secondary' })}>
              {t.phone.action}
            </a>
          </section>
        </section>

        <div className="download__prefs">
          <ThemeSwitch />
          <LanguageSwitch />
        </div>
      </main>
    </div>
  );
}
