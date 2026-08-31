import { useTranslation } from 'react-i18next';
import { Card, Chip } from '@heroui/react';
import { ArrowUpRightFromSquare } from '@gravity-ui/icons';

export interface PluginCardProps {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  route?: string;
  hasRoute?: boolean;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PluginCard({ name, description, version, author, route, hasRoute = true, footer, actions }: PluginCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex-col">
      <div className="relative h-[140px] w-full shrink-0 overflow-hidden">
        <img
          alt="icon"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none dark:invert"
          loading="lazy"
          src="/images/icon2.webp"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <Card.Header className="gap-1">
          <div className="flex flex-wrap items-center gap-2 pe-8">
            <Card.Title className="text-lg">{name}</Card.Title>
            {version && <Chip size="sm" variant="secondary">{version}</Chip>}
            {hasRoute && route && (
              <Chip size="sm" color="accent" variant="soft" className="gap-1">
                <ArrowUpRightFromSquare className="w-3 h-3" />
                {t('plugins.hasPage')}
              </Chip>
            )}
          </div>
          <Card.Description>
            {description && <p className="text-[15px] mt-1 text-default-600 line-clamp-2">{description}</p>}
            <p className="text-xs text-default-400 mt-1">
              {author && `${t('plugins.author')}: ${author}`}
            </p>
          </Card.Description>
        </Card.Header>
        {footer !== undefined && (
          <Card.Footer className="mt-auto flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            {footer}
          </Card.Footer>
        )}
      </div>
      {actions}
    </Card>
  );
}
