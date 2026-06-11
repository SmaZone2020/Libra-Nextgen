import { useTranslation } from 'react-i18next';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="prose prose-neutral max-w-none text-sm text-neutral-700 space-y-3">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto space-y-10 py-4">

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
        <ul className="list-disc pl-6 space-y-1 text-neutral-600">
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
        <ul className="list-disc pl-6 space-y-1 text-neutral-600">
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

        <h3 className="text-base font-medium text-neutral-800 !mt-5">{t('about.lawCnTitle')}</h3>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600">
          <li>{t('about.lawCnLi1')}</li>
          <li>{t('about.lawCnLi2')}</li>
          <li>{t('about.lawCnLi3')}</li>
          <li>{t('about.lawCnLi4')}</li>
        </ul>

        <h3 className="text-base font-medium text-neutral-800 !mt-5">{t('about.lawIntlTitle')}</h3>
        <ul className="list-disc pl-6 space-y-1 text-neutral-600">
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
        <ul className="list-disc pl-6 space-y-1 text-neutral-600">
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
