import { useTranslation } from 'react-i18next';

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto space-y-10 py-4">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">
          {t('about.licenseTitle')}
        </h2>
        <div className="prose prose-neutral max-w-none text-sm text-neutral-700 space-y-3">
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
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">
          {t('about.disclaimerTitle')}
        </h2>
        <div className="prose prose-neutral max-w-none text-sm text-neutral-700 space-y-3">
          <p>{t('about.disclaimerP1')}</p>
          <p>{t('about.disclaimerP2')}</p>
          <p>{t('about.disclaimerP3')}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">
          {t('about.waiverTitle')}
        </h2>
        <div className="prose prose-neutral max-w-none text-sm text-neutral-700 space-y-3">
          <p>{t('about.waiverP1')}</p>
          <p>{t('about.waiverP2')}</p>
          <p>{t('about.waiverP3')}</p>
        </div>
      </section>
    </div>
  );
}
