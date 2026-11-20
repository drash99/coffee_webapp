import { useEffect, useState } from 'react';
import { Battery, Printer, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { getBrotherPrinterStatus, type BrotherPrinterStatus } from '../../platform';
import { BEAN_LABEL_DIMENSIONS } from '../utils/beanLabelImage';

type Props = { printerName: string; printing: boolean };

export function BrotherPrinterStatusPanel({ printerName, printing }: Props) {
  const { t, lang } = useI18n();
  const [snapshot, setSnapshot] = useState<{ requestedName: string; status: BrotherPrinterStatus } | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (printing) return;
    let cancelled = false;
    let pending = false;
    async function check() {
      if (pending || document.hidden) return;
      pending = true;
      setChecking(true);
      setFailed(false);
      try {
        const status = await getBrotherPrinterStatus({ printerName });
        if (!cancelled) setSnapshot({ requestedName: printerName, status });
      } catch {
        if (!cancelled) {
          setSnapshot(null);
          setFailed(true);
        }
      } finally {
        pending = false;
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const onVisibility = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [printerName, printing, refresh]);

  const status = snapshot?.requestedName === printerName ? snapshot.status : null;
  const connected = status?.connection === 'connected';
  const battery = connected ? status.battery : undefined;
  const validLevel = battery?.level != null && battery.maxLevel != null &&
    Number.isFinite(battery.level) && Number.isFinite(battery.maxLevel) &&
    battery.maxLevel > 0 && battery.level >= 0 && battery.level <= battery.maxLevel;
  const width = connected ? status.media?.widthMm : undefined;
  const connectionText = printing ? t('beanLabels.printer.printing')
    : checking ? t('beanLabels.printer.checking')
      : failed ? t('beanLabels.printer.failed')
        : status ? t(`beanLabels.printer.${status.connection}`) : t('beanLabels.printer.unknown');

  return (
    <section className="no-print border-y border-gray-200 py-3 space-y-3" aria-label={t('beanLabels.printer.title')}>
      <div className="flex items-center gap-3 min-w-0">
        <Printer size={18} className="text-gray-500 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium break-words">{connected ? status.printerName : printerName}</div>
          <div className={`text-xs ${connected && !checking ? 'text-green-700' : 'text-gray-500'}`} role="status">
            {connectionText}{connected && status.transport ? ` · ${status.transport}` : ''}
          </div>
        </div>
        <button type="button" className="p-2 rounded-md hover:bg-gray-100 disabled:opacity-40 shrink-0"
          title={t('beanLabels.printer.refresh')} aria-label={t('beanLabels.printer.refresh')}
          disabled={printing || checking} onClick={() => setRefresh(value => value + 1)}>
          <RefreshCw size={18} className={checking && !printing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      {connected && (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
            <dt className="text-gray-500">{t('beanLabels.printer.battery')}</dt>
            <dd className="flex flex-wrap items-center gap-2 min-w-0">
              <Battery size={16} aria-hidden="true" />
              {battery?.mounted === false ? t('beanLabels.printer.notMounted') : validLevel ? (
                <>
                  <progress className="w-16 h-2 accent-green-700" value={battery!.level} max={battery!.maxLevel}
                    aria-label={t('beanLabels.printer.battery')} />
                  <span>{battery!.maxLevel === 100
                    ? t('beanLabels.printer.batteryPercent', { percent: battery!.level! })
                    : t('beanLabels.printer.batteryLevel', { current: battery!.level!, max: battery!.maxLevel! })}</span>
                </>
              ) : t('beanLabels.printer.unknown')}
              {battery?.charging === true && <span>{t('beanLabels.printer.charging')}</span>}
            </dd>
            <dt className="text-gray-500">{t('beanLabels.printer.media')}</dt>
            <dd>{status.state === 'noPaper' ? t('beanLabels.printer.state.noPaper')
              : width ? t('beanLabels.printer.width', { width }) : t('beanLabels.printer.unknown')}</dd>
            <dt className="text-gray-500">{t('beanLabels.printer.remaining')}</dt>
            <dd>{t('beanLabels.printer.unknown')}</dd>
            <dt className="text-gray-500">{t('beanLabels.printer.condition')}</dt>
            <dd className={status.state && status.state !== 'ready' ? 'text-red-700' : 'text-gray-700'}>
              {status.state ? t(`beanLabels.printer.state.${status.state}`) : t('beanLabels.printer.unknown')}
            </dd>
          </dl>
          {width && width !== BEAN_LABEL_DIMENSIONS.tapeWidthMm && status.state !== 'noPaper' && (
            <p role="alert" className="text-xs text-amber-800">{t('beanLabels.printer.wrongWidth', { width })}</p>
          )}
        </>
      )}
      {status && <p className="text-[11px] text-gray-400">{t('beanLabels.printer.checked', {
        time: new Date(status.checkedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      })}</p>}
    </section>
  );
}
