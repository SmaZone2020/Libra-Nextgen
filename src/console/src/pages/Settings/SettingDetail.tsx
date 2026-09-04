'use client';

import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@heroui/react';
import { getVisibleSettingRoutes } from './SettingsPage';

export function SettingDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settingId } = useParams<{ settingId: string }>();
  const route = getVisibleSettingRoutes().find((r) => r.id === settingId);
  if (!route) return null;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onPress={() => navigate('/settings')}>
        ← {t('settings.securityBack')}
      </Button>
      {route.render()}
    </div>
  );
}
