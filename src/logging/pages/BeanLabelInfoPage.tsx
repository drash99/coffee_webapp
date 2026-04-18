import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient, isSupabaseConfigured } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import type { FlavorNote } from '../types';
import { fmtDate } from '../utils/formatting';
import { NoteDotsList } from '../components/NoteDotsList';

type Props = {
  labelUid: string;
  viewerUser: AppUser | null;
  isGuest: boolean;
  standalone?: boolean;
};

type PublicBeanLabelRow = {
  label_uid: string;
  grams: number | null;
  bean_uid: string;
  bean_user_uid: string;
  bean_name: string | null;
  roastery: string | null;
  producer: string | null;
  origin_location: string | null;
  origin_country: string | null;
  process: string | null;
  varietal: string | null;
  roasted_on: string | null;
  cup_flavor_notes: FlavorNote[] | null;
  created_at: string;
};

function navigate(url: string) {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function BeanLabelInfoPage({ labelUid, viewerUser, isGuest, standalone = false }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<PublicBeanLabelRow | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setError(null);
      setLoading(true);
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(labelUid);
        if (!isUuid) {
          setRow(null);
          return;
        }
        if (!isSupabaseConfigured()) throw new Error(t('analysis.grindMap.supabaseNotConfigured'));
        const supabase = getSupabaseClient();
        const { data, error: rpcErr } = await supabase.rpc('get_public_bean_by_label_uid', { p_label_uid: labelUid });
        if (rpcErr) throw new Error(rpcErr.message);
        const first = Array.isArray(data) ? ((data[0] as PublicBeanLabelRow | undefined) ?? null) : null;
        if (!active) return;
        setRow(first);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : t('common.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [labelUid, t]);

  const isOwner = useMemo(() => {
    if (!row) return false;
    if (!viewerUser || isGuest) return false;
    return viewerUser.uid === row.bean_user_uid;
  }, [row, viewerUser, isGuest]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between gap-3">
          <span>{t('beanLabelInfo.title')}</span>
          {!standalone && (
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
              onClick={() => navigate('/')}
            >
              {t('beanLabelInfo.backToApp')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-4 text-sm text-gray-500">{t('beanLabelInfo.loading')}</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 border-t border-red-100">{error}</div>
        ) : !row ? (
          <div className="p-4 text-sm text-gray-500">{t('beanLabelInfo.notFound')}</div>
        ) : (
          <div className="p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-gray-500">
                {t('beanLabelInfo.labeledAt', { date: fmtDate(row.created_at) })}
                {row.grams != null ? ` · ${t('beanLabelInfo.grams', { grams: String(row.grams) })}` : ''}
              </div>
              {isOwner && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap"
                    onClick={() =>
                      navigate(
                        `/?bean=${encodeURIComponent(row.bean_uid)}${
                          row.grams != null ? `&doseG=${encodeURIComponent(String(row.grams))}` : ''
                        }`,
                      )
                    }
                  >
                    {row.grams != null
                      ? t('beanLabelInfo.actions.logThisBeanWithDose', { grams: String(row.grams) })
                      : t('beanLabelInfo.actions.logThisBean')}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
                    onClick={() => navigate(`/?historyBean=${encodeURIComponent(row.bean_uid)}`)}
                  >
                    {t('beanLabelInfo.actions.viewHistory')}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.name')}</div>
                <div className="font-medium text-gray-900">{row.bean_name || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.roastedOn')}</div>
                <div className="font-medium text-gray-900">{row.roasted_on ? fmtDate(row.roasted_on) : t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.roastery')}</div>
                <div className="font-medium text-gray-900">{row.roastery || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.producer')}</div>
                <div className="font-medium text-gray-900">{row.producer || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.originLocation')}</div>
                <div className="font-medium text-gray-900">{row.origin_location || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.originCountry')}</div>
                <div className="font-medium text-gray-900">{row.origin_country || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.process')}</div>
                <div className="font-medium text-gray-900">{row.process || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.varietal')}</div>
                <div className="font-medium text-gray-900">{row.varietal || t('common.none')}</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500">{t('bean.field.cupNotesSca')}</div>
              <NoteDotsList notes={row.cup_flavor_notes ?? []} emptyLabel={t('common.none')} />
            </div>

            {!standalone && !isOwner && (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-2">
                {t('beanLabelInfo.ownerHint')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
