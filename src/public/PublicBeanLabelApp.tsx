import { useMemo } from 'react';
import { BeanLabelInfoPage } from '../logging/pages/BeanLabelInfoPage';
import { parseLabelUidFromLocation } from '../logging/utils/publicLinks';
import { useI18n } from '../i18n/I18nProvider';
import { StandalonePageLayout } from './StandalonePageLayout';

export function PublicBeanLabelApp() {
  const { t } = useI18n();
  const labelUid = useMemo(() => parseLabelUidFromLocation(window.location), []);

  return (
    <StandalonePageLayout>
      {labelUid ? (
        <BeanLabelInfoPage labelUid={labelUid} viewerUser={null} isGuest={false} standalone />
      ) : (
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 text-sm text-gray-500">{t('beanLabelInfo.notFound')}</div>
          </div>
        </div>
      )}
    </StandalonePageLayout>
  );
}
