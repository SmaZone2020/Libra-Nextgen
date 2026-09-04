import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import { ArrowChevronRight, Code } from '@gravity-ui/icons';
import { getAccountMe } from '../../api/account';
import { canSeeRoute } from '../../utils/permissions';

/** Mobile-only entry card linking to the payload builder, pinned at the top
 *  of the agent list ("Devices" tab). Hidden above the sm breakpoint. */
export function MobileBuilderEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccountMe()
      .then((me) => {
        if (!cancelled) setVisible(canSeeRoute(me.permissions ?? null, '/builder'));
      })
      .catch(() => {
        if (!cancelled) setVisible(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  return (
    <Button
      variant="secondary"
      className="w-full h-auto justify-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:hidden"
      onPress={() => navigate('/builder')}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Code className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">{t('nav.builder')}</span>
        <span className="block truncate text-xs text-muted">{t('pageMeta.builder.subtitle')}</span>
      </span>
      <ArrowChevronRight className="size-4 shrink-0 text-muted" />
    </Button>
  );
}
