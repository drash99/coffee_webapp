import { useMemo } from 'react';
import { SharedBrewPage } from '../logging/pages/SharedBrewPage';
import { parseSharedTokenFromLocation } from '../logging/utils/publicLinks';
import { useI18n } from '../i18n/I18nProvider';
import { StandalonePageLayout } from './StandalonePageLayout';

export function PublicSharedBrewApp() {
  const { t } = useI18n();
  const token = useMemo(() => parseSharedTokenFromLocation(window.location), []);

  return (
    <StandalonePageLayout>
      {token ? (
        <SharedBrewPage token={token} />
      ) : (
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 text-sm text-gray-500">{t('sharedBrew.notFound')}</div>
          </div>
        </div>
      )}
    </StandalonePageLayout>
  );
}
