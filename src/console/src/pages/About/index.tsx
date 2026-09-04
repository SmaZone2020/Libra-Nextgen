import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@heroui/react';
import { LogoGithub } from '@gravity-ui/icons';
import Markdown from 'react-markdown';
import { checkForUpdate, getUpdateStatus } from '../../api/system';
import type { ServerUpdateState } from '../../api/system';

const REPO_URL = 'https://github.com/SmaZone2020/Libra-Nextgen';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="prose prose-neutral max-w-none text-sm text-neutral-700 dark:text-neutral-300 space-y-3">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ServerUpdateState | null>(null);

  // Auto update check on page entry: show the cached state immediately, then
  // force a fresh GitHub check in the background.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await getUpdateStatus();
        if (alive) setStatus(cached);
      } catch {
        // Ignore — the fresh check below reports the failure if any.
      }
      try {
        const fresh = await checkForUpdate();
        if (alive) setStatus(fresh);
      } catch {
        // Server unreachable or update check disabled.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-10 py-4">
      <div className="flex flex-col items-center justify-center gap-4 select-none pointer-events-none">
        <div className="flex gap-4">
          <img
            alt="icon"
            className="size-50 object-cover dark:invert"
            loading="lazy"
            src="/images/icon2.webp"
          />
        </div>
        <p className="text-4xl font-bold whitespace-nowrap text-neutral-900 dark:text-neutral-100 libre">
          Libra Nextgen
        </p>
        <div className='flex items-center gap-2'>
          <img src="https://img.shields.io/badge/.NET-C172D7?style=flat-square&logo=.net&logoColor=black" alt=".NET"/>
          <img src="https://img.shields.io/badge/Rust-FFFFFF?style=flat-square&logo=rust&logoColor=black" alt="Rust"/>
          <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
          <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"/>
        </div>
      </div>

      {/* Version & Updates */}
      <Section title={t('about.updateTitle')}>
        <div className="flex items-center gap-2">
          <span className="font-medium">{t('about.sourceCode')}:</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-primary-600 underline underline-offset-2"
          >
            SmaZone2020/Libra-Nextgen
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{t('about.currentVersion')}:</span>
          <img src="https://img.shields.io/github/v/release/SmaZone2020/Libra-Nextgen?style=flat-square" alt="Release" />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {status?.updateAvailable ? (
            <Chip size="sm" variant="soft" color="warning">
              {t('about.updateAvailable')} v{status.latestTag}
            </Chip>
          ) : status ? (
            <Chip size="sm" variant="soft" color="success">
              {t('about.upToDate')}
            </Chip>
          ) : null}
        </div>
        {status?.updateAvailable && status.latestTag && (
          <div className="space-y-2 !mt-4">
            <p className="font-medium">
              {t('about.releaseNotes')} — v{status.latestTag}
              {status.publishedAt ? ` · ${new Date(status.publishedAt).toLocaleDateString()}` : ''}
            </p>
            {status.notes && <Markdown>{status.notes}</Markdown>}
            {status.htmlUrl && (
              <a
                href={status.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-primary-600 underline underline-offset-2"
              >
                {t('about.openRelease')}
              </a>
            )}
          </div>
        )}
        {status?.error && (
          <p className="text-sm text-danger">
            {t('about.checkFailed')}: {status.error}
          </p>
        )}
      </Section>

      {/* License */}
      <Section title={t('about.licenseTitle')}>
        <p>{t('about.licenseP1')}</p>
        <p>{t('about.licenseP2')}</p>
        <p>
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 underline underline-offset-2"
          >
            {t('about.viewFullLicense')}
          </a>
        </p>
      </Section>

      {/* Authorized Use */}
      <Section title={t('about.authorizedTitle')}>
        <p>{t('about.authorizedP1')}</p>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600 dark:text-neutral-400">
          <li>{t('about.authorizedLi1')}</li>
          <li>{t('about.authorizedLi2')}</li>
          <li>{t('about.authorizedLi3')}</li>
          <li>{t('about.authorizedLi4')}</li>
          <li>{t('about.authorizedLi5')}</li>
        </ul>
        <p>{t('about.authorizedP2')}</p>
      </Section>

      {/* Prohibited Use */}
      <Section title={t('about.prohibitedTitle')}>
        <p>{t('about.prohibitedP1')}</p>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600 dark:text-neutral-400">
          <li>{t('about.prohibitedLi1')}</li>
          <li>{t('about.prohibitedLi2')}</li>
          <li>{t('about.prohibitedLi3')}</li>
          <li>{t('about.prohibitedLi4')}</li>
          <li>{t('about.prohibitedLi5')}</li>
          <li>{t('about.prohibitedLi6')}</li>
        </ul>
      </Section>

      {/* Applicable Laws */}
      <Section title={t('about.applicableLawTitle')}>
        <p>{t('about.applicableLawP1')}</p>

        <h3 className="text-base font-medium text-neutral-800 dark:text-neutral-400 !mt-5">{t('about.lawCnTitle')}</h3>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600 dark:text-neutral-400">
          <li>{t('about.lawCnLi1')}</li>
          <li>{t('about.lawCnLi2')}</li>
          <li>{t('about.lawCnLi3')}</li>
          <li>{t('about.lawCnLi4')}</li>
        </ul>

        <h3 className="text-base font-medium text-neutral-800 dark:text-neutral-400 !mt-5">{t('about.lawIntlTitle')}</h3>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600 dark:text-neutral-400">
          <li>{t('about.lawIntlLi1')}</li>
          <li>{t('about.lawIntlLi2')}</li>
          <li>{t('about.lawIntlLi3')}</li>
          <li>{t('about.lawIntlLi4')}</li>
        </ul>
      </Section>

      {/* Disclaimer */}
      <Section title={t('about.disclaimerTitle')}>
        <p>{t('about.disclaimerP1')}</p>
        <p>{t('about.disclaimerP2')}</p>
        <p>{t('about.disclaimerP3')}</p>
        <p>{t('about.disclaimerP4')}</p>
      </Section>

      {/* Export Control */}
      <Section title={t('about.exportTitle')}>
        <p>{t('about.exportP1')}</p>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600 dark:text-neutral-400">
          <li>{t('about.exportLi1')}</li>
          <li>{t('about.exportLi2')}</li>
          <li>{t('about.exportLi3')}</li>
          <li>{t('about.exportLi4')}</li>
        </ul>
        <p>{t('about.exportP2')}</p>
      </Section>

      {/* Limitation of Liability */}
      <Section title={t('about.waiverTitle')}>
        <p>{t('about.waiverP1')}</p>
        <p>{t('about.waiverP2')}</p>
        <p>{t('about.waiverP3')}</p>
        <p>{t('about.waiverP4')}</p>
      </Section>

    </div>
  );
}
