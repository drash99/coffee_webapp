import { useEffect, useId, useRef, useState } from 'react';
import { ClipboardCopy, ClipboardPaste, FileJson } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { I18nKey } from '../../i18n/i18n';

type Props = {
  prompt: string;
  onImport: (raw: string) => void;
  coffee?: boolean;
};

const buttonClass = 'inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50';

export function PhotoImportPanel({ prompt, onImport, coffee = false }: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const [json, setJson] = useState('');
  const [message, setMessage] = useState<{ key: I18nKey; error?: boolean }>();
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function copyPrompt() {
    setMessage(undefined);
    setPending(true);
    try {
      await navigator.clipboard.writeText(prompt);
      if (mounted.current) setMessage({ key: coffee ? 'beanImport.prompt.copied' : 'beverage.import.copied' });
    } catch {
      if (mounted.current) setMessage({ key: 'beanImport.prompt.copyFailed', error: true });
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  function importText(raw: string) {
    if (!raw.trim()) {
      setMessage({ key: 'beanImport.error.empty', error: true });
      return;
    }
    try {
      onImport(raw);
      setMessage({ key: coffee ? 'beanImport.imported' : 'beverage.import.imported' });
    } catch {
      setMessage({ key: coffee ? 'beanImport.error.invalid' : 'beverage.import.invalid', error: true });
    }
  }

  async function importClipboard() {
    setMessage(undefined);
    setPending(true);
    try {
      const raw = await navigator.clipboard.readText();
      if (!mounted.current) return;
      setJson(raw);
      importText(raw);
    } catch {
      if (mounted.current) setMessage({ key: 'beanImport.error.clipboardRead', error: true });
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-800">{t(coffee ? 'beanImport.title' : 'beverage.import.title')}</h3>
        <p className="text-xs text-gray-600">{t(coffee ? 'beanImport.description' : 'beverage.import.description')}</p>
      </div>
      <button type="button" disabled={pending} className={`${buttonClass} bg-white hover:bg-gray-50`} onClick={() => void copyPrompt()}>
        <ClipboardCopy size={16} className="shrink-0" aria-hidden="true" />{t('beanImport.prompt.copy')}
      </button>
    </div>
    <div>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-gray-600">{t('beanImport.json.label')}</label>
      <textarea id={inputId} className="min-h-24 w-full min-w-0 rounded-lg border bg-white p-2 font-mono text-base"
        value={json} disabled={pending} onChange={event => {
          setJson(event.target.value);
          setMessage(undefined);
        }} placeholder={t('beanImport.json.placeholder')} spellCheck={false} />
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending} className={`${buttonClass} bg-amber-700 text-white hover:bg-amber-800`}
        onClick={() => void importClipboard()}>
        <ClipboardPaste size={16} className="shrink-0" aria-hidden="true" />{t('beanImport.clipboardImport')}
      </button>
      <button type="button" disabled={pending} className={`${buttonClass} bg-white hover:bg-gray-50`} onClick={() => importText(json)}>
        <FileJson size={16} className="shrink-0" aria-hidden="true" />{t('beanImport.textImport')}
      </button>
    </div>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-xs text-red-700' : 'text-xs text-gray-600'}>
      {t(message.key)}
    </p>}
  </div>;
}
