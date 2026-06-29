import { isSupabaseConfigured } from '../../config/supabase';
import type { AppUser } from '../../auth/types';
import { logout } from '../../auth/authService';
import { useI18n } from '../../i18n/I18nProvider';
import {
  localHasData,
  localGetAllData,
  localBuildBackupPayload,
  localRestoreFromBackup,
  migrateLocalToSupabase,
} from '../storage';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { useRef, useState } from 'react';
import type { LanguageCode } from '../../i18n/i18n';
import {
  buildAiServerBaseUrl,
  clearAiBearerToken,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_SERVER_HOST,
  DEFAULT_AI_SERVER_PORT,
  getAiBearerToken,
  getAiModelId,
  getAiServerHost,
  getAiServerPort,
  getAiTempUnit,
  setAiBearerToken,
  setAiModelId,
  setAiServerHost,
  setAiServerPort,
  setAiTempUnit,
} from '../ai/prefs';
import { fetchAiServerHealth, fetchAiServerModels, type AiServerModel } from '../ai/customServerClient';
import {
  DEFAULT_BROTHER_PRINTER_NAME,
  DEFAULT_LABEL_PUBLIC_BASE_URL,
  getDefaultLabelCount,
  getDefaultLabelGrams,
  getLabelPublicBaseUrl,
  getLabelPrinterName,
  setLabelPublicBaseUrl,
  setDefaultLabelCount,
  setDefaultLabelGrams,
  setLabelPrinterName,
} from '../labels/prefs';
import { canPrintBrotherLabels, getPlatform, printBrotherLabels } from '../../platform';
import { renderBeanLabelDataUrl } from '../utils/beanLabelImage';
import { toQrDataUrl } from '../utils/qr';

type AuthTab = 'login' | 'signup';

type Props = {
  user: AppUser | null;
  isGuest: boolean;
  onAuthSuccess: (u: AppUser) => void;
  onLogout: () => void;
  onExitGuest: () => void;
  onEnterGuest: () => void;
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
};

export function SettingsPage({
  user,
  isGuest,
  onAuthSuccess,
  onLogout,
  onExitGuest,
  onEnterGuest,
  lang,
  setLang,
}: Props) {
  const { t } = useI18n();
  const isIos = getPlatform() === 'ios';
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);
  const [aiServerHostInput, setAiServerHostInput] = useState(() => getAiServerHost());
  const [aiServerPortInput, setAiServerPortInput] = useState(() => getAiServerPort());
  const [aiBearerTokenInput, setAiBearerTokenInput] = useState(() => getAiBearerToken() ?? '');
  const [aiModelIdInput, setAiModelIdInput] = useState(() => getAiModelId());
  const [aiTempUnit, setAiTempUnitState] = useState<'C' | 'F'>(() => getAiTempUnit());
  const [aiMsg, setAiMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [aiModels, setAiModels] = useState<AiServerModel[]>([]);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiLoadingModels, setAiLoadingModels] = useState(false);
  const [labelPrinterNameInput, setLabelPrinterNameInput] = useState(() => getLabelPrinterName());
  const [labelPublicBaseUrlInput, setLabelPublicBaseUrlInput] = useState(() => getLabelPublicBaseUrl());
  const [labelDefaultGramsInput, setLabelDefaultGramsInput] = useState(() => getDefaultLabelGrams());
  const [labelDefaultCountInput, setLabelDefaultCountInput] = useState(() => getDefaultLabelCount());
  const [labelMsg, setLabelMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [testPrintBusy, setTestPrintBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const localData = localGetAllData();
  const canManageGuestBackup = isGuest || !user;
  const supportsNativeLabelPrint = canPrintBrotherLabels();

  async function handleMigrateData() {
    if (!localHasData()) return;
    const allData = localGetAllData();
    const msg = t('guest.migrate.confirm', {
      beans: allData.beans.length,
      brews: allData.brews.length,
    });
    if (!window.confirm(msg)) return;
    setMigrating(true);
    setMigrateMsg(null);
    try {
      await migrateLocalToSupabase();
      setMigrateMsg(t('guest.migrate.done'));
    } catch (e) {
      setMigrateMsg(
        t('guest.migrate.failed', {
          message: e instanceof Error ? e.message : 'Unknown error',
        })
      );
    } finally {
      setMigrating(false);
    }
  }

  function buildAiConfigFromInputs() {
    const host = aiServerHostInput.trim() || DEFAULT_AI_SERVER_HOST;
    const port = aiServerPortInput.trim() || DEFAULT_AI_SERVER_PORT;
    const modelId = aiModelIdInput.trim() || DEFAULT_AI_MODEL_ID;
    const bearerToken = aiBearerTokenInput.trim() || null;

    try {
      void buildAiServerBaseUrl(host, port);
    } catch {
      throw new Error(t('settings.ai.server.invalid'));
    }

    return {
      host,
      port,
      bearerToken,
      modelId,
    };
  }

  function saveAiSettings() {
    try {
      const next = buildAiConfigFromInputs();
      setAiServerHost(next.host);
      setAiServerPort(next.port);
      setAiBearerToken(next.bearerToken ?? '');
      setAiModelId(next.modelId);
      setAiTempUnit(aiTempUnit);
      setAiServerHostInput(next.host);
      setAiServerPortInput(next.port);
      setAiBearerTokenInput(next.bearerToken ?? '');
      setAiModelIdInput(next.modelId);
      setAiMsg({ tone: 'success', text: t('settings.ai.saved') });
    } catch (e) {
      setAiMsg({
        tone: 'error',
        text: e instanceof Error ? e.message : t('common.loadFailed'),
      });
    }
  }

  async function handleAiTestConnection() {
    setAiTesting(true);
    setAiMsg(null);
    try {
      const config = buildAiConfigFromInputs();
      const health = await fetchAiServerHealth(config);
      setAiMsg({
        tone: 'success',
        text: t('settings.ai.health.ok', {
          server: health.server || t('common.none'),
          version: health.version || t('common.none'),
        }),
      });
    } catch (e) {
      setAiMsg({
        tone: 'error',
        text: e instanceof Error ? e.message : t('settings.ai.health.failed'),
      });
    } finally {
      setAiTesting(false);
    }
  }

  async function handleAiLoadModels() {
    setAiLoadingModels(true);
    setAiMsg(null);
    try {
      const config = buildAiConfigFromInputs();
      const models = await fetchAiServerModels(config);
      setAiModels(models);
      if (models.length > 0 && !aiModelIdInput.trim()) {
        setAiModelIdInput(models[0].id);
      }
      setAiMsg({
        tone: 'success',
        text:
          models.length > 0
            ? t('settings.ai.models.loaded', { count: String(models.length) })
            : t('settings.ai.models.empty'),
      });
    } catch (e) {
      setAiMsg({
        tone: 'error',
        text: e instanceof Error ? e.message : t('settings.ai.models.failed'),
      });
    } finally {
      setAiLoadingModels(false);
    }
  }

  function saveLabelSettings() {
    if (labelPublicBaseUrlInput.trim() && !isValidPublicUrl(labelPublicBaseUrlInput)) {
      setLabelMsg({ tone: 'error', text: t('settings.labels.publicBaseUrl.invalid') });
      return;
    }
    setLabelPrinterName(labelPrinterNameInput);
    setLabelPublicBaseUrl(labelPublicBaseUrlInput);
    setDefaultLabelGrams(labelDefaultGramsInput);
    setDefaultLabelCount(labelDefaultCountInput);
    setLabelPrinterNameInput(getLabelPrinterName());
    setLabelPublicBaseUrlInput(getLabelPublicBaseUrl());
    setLabelDefaultGramsInput(getDefaultLabelGrams());
    setLabelDefaultCountInput(getDefaultLabelCount());
    setLabelMsg({ tone: 'success', text: t('settings.labels.saved') });
  }

  async function handleTestPrint() {
    if (!supportsNativeLabelPrint) {
      setLabelMsg({ tone: 'error', text: t('settings.labels.testPrintUnavailable') });
      return;
    }

    setTestPrintBusy(true);
    setLabelMsg(null);
    try {
      if (labelPublicBaseUrlInput.trim() && !isValidPublicUrl(labelPublicBaseUrlInput)) {
        throw new Error(t('settings.labels.publicBaseUrl.invalid'));
      }
      const printerName = labelPrinterNameInput.trim() || DEFAULT_BROTHER_PRINTER_NAME;
      const publicBaseUrl = labelPublicBaseUrlInput.trim() || DEFAULT_LABEL_PUBLIC_BASE_URL;
      const qrDataUrl = await toQrDataUrl(publicBaseUrl, 160, {
        errorCorrectionLevel: 'L',
        margin: 1,
      });
      const printDataUrl = await renderBeanLabelDataUrl({
        roasteryText: t('app.title'),
        beanName: t('settings.labels.testPrint'),
        originText: printerName,
        producerProcessText: null,
        varietalText: null,
        footerText: t('settings.labels.testFooter'),
        qrDataUrl,
        qrText: publicBaseUrl,
      });
      await printBrotherLabels({
        printerName,
        labels: [{ pngDataUrl: printDataUrl }],
      });
      setLabelMsg({ tone: 'success', text: t('settings.labels.testPrinted') });
    } catch (e) {
      setLabelMsg({
        tone: 'error',
        text: e instanceof Error ? e.message : t('settings.labels.testPrintUnavailable'),
      });
    } finally {
      setTestPrintBusy(false);
    }
  }

  function handleExportBackup() {
    if (!localHasData()) {
      setBackupMsg(t('settings.backup.empty'));
      return;
    }

    const payload = localBuildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `beanlog-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMsg(t('settings.backup.saved'));
  }

  async function handleRestoreBackupFile(file: File | null) {
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      if (!window.confirm(t('settings.backup.confirmReplace'))) {
        return;
      }
      const restored = localRestoreFromBackup(parsed);
      if (!isGuest && !user) {
        onEnterGuest();
      }
      setBackupMsg(
        t('settings.backup.restored', {
          beans: restored.beans.length,
          brews: restored.brews.length,
          labels: restored.beanLabels.length,
        }),
      );
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : t('settings.backup.invalid'));
    } finally {
      if (restoreInputRef.current) {
        restoreInputRef.current.value = '';
      }
    }
  }

  function isValidPublicUrl(value: string): boolean {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* About */}
      <section className="p-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.about.title')}</h2>
        <p className="text-sm text-gray-600">{t('settings.about.description')}</p>
        <p className="text-xs text-gray-400 mt-2">
          {t('settings.about.version')} 0.0.0 · {t('settings.about.build')}{' '}
          {new Date(__BUILD_TIME__).toLocaleDateString()}
        </p>
      </section>

      {/* Language */}
      <section className="p-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.language.title')}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${
              lang === 'en-us' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => setLang('en-us')}
          >
            {t('app.lang.english')} (EN)
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${
              lang === 'ko-kr' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => setLang('ko-kr')}
          >
            {t('app.lang.korean')} (KO)
          </button>
        </div>
      </section>

      {isIos && (
        <section className="p-4 border-b border-gray-100 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">{t('settings.ai.title')}</h2>
          <p className="text-xs text-gray-500 whitespace-pre-line">{t('settings.ai.description')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.ai.host.label')}</label>
              <input
                className="w-full p-2 border rounded-lg text-base"
                type="text"
                value={aiServerHostInput}
                onChange={(e) => setAiServerHostInput(e.target.value)}
                placeholder={t('settings.ai.host.placeholder')}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.ai.port.label')}</label>
              <input
                className="w-full p-2 border rounded-lg text-base"
                type="text"
                value={aiServerPortInput}
                onChange={(e) => setAiServerPortInput(e.target.value)}
                placeholder={t('settings.ai.port.placeholder')}
                inputMode="numeric"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.ai.token.label')}</label>
              <input
                className="w-full p-2 border rounded-lg text-base"
                type="password"
                value={aiBearerTokenInput}
                onChange={(e) => setAiBearerTokenInput(e.target.value)}
                placeholder={t('settings.ai.token.placeholder')}
              />
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
                  onClick={() => {
                    clearAiBearerToken();
                    setAiBearerTokenInput('');
                    setAiMsg({ tone: 'success', text: t('settings.ai.token.cleared') });
                  }}
                >
                  {t('settings.ai.token.clear')}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.ai.model.label')}</label>
              <input
                className="w-full p-2 border rounded-lg text-base"
                type="text"
                value={aiModelIdInput}
                onChange={(e) => setAiModelIdInput(e.target.value)}
                placeholder={t('settings.ai.model.placeholder')}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                {t('settings.ai.model.help', { defaultModelId: DEFAULT_AI_MODEL_ID })}
              </p>
            </div>
            {aiModels.length > 0 && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.ai.models.label')}</label>
                <select
                  className="w-full p-2 border rounded-lg text-base bg-white"
                  value={aiModelIdInput}
                  onChange={(e) => setAiModelIdInput(e.target.value)}
                >
                  {aiModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-500 mb-1">{t('settings.ai.tempUnit.label')}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs border whitespace-nowrap ${
                  aiTempUnit === 'C'
                    ? 'bg-amber-700 text-white border-amber-700'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => {
                  setAiTempUnit('C');
                  setAiTempUnitState('C');
                }}
              >
                {t('settings.ai.tempUnit.c')}
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs border whitespace-nowrap ${
                  aiTempUnit === 'F'
                    ? 'bg-amber-700 text-white border-amber-700'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => {
                  setAiTempUnit('F');
                  setAiTempUnitState('F');
                }}
              >
                {t('settings.ai.tempUnit.f')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap"
              onClick={saveAiSettings}
            >
              {t('settings.ai.save')}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
              onClick={() => void handleAiTestConnection()}
              disabled={aiTesting}
            >
              {aiTesting ? t('settings.ai.health.testing') : t('settings.ai.health.test')}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
              onClick={() => void handleAiLoadModels()}
              disabled={aiLoadingModels}
            >
              {aiLoadingModels ? t('settings.ai.models.loading') : t('settings.ai.models.load')}
            </button>
          </div>

          {aiMsg && (
            <p
              className={`text-xs border rounded-lg p-2 ${
                aiMsg.tone === 'error'
                  ? 'text-red-700 bg-red-50 border-red-100'
                  : 'text-amber-800 bg-amber-50 border-amber-200'
              }`}
            >
              {aiMsg.text}
            </p>
          )}
        </section>
      )}

      <section className="p-4 border-b border-gray-100 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">{t('settings.labels.title')}</h2>
        <p className="text-xs text-gray-500">{t('settings.labels.description')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.labels.printerName.label')}</label>
            <input
              className="w-full p-2 border rounded-lg text-base"
              type="text"
              value={labelPrinterNameInput}
              onChange={(e) => setLabelPrinterNameInput(e.target.value)}
              placeholder={t('settings.labels.printerName.placeholder')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {t('settings.labels.publicBaseUrl.label')}
            </label>
            <input
              className="w-full p-2 border rounded-lg text-base"
              type="url"
              value={labelPublicBaseUrlInput}
              onChange={(e) => setLabelPublicBaseUrlInput(e.target.value)}
              placeholder={t('settings.labels.publicBaseUrl.placeholder')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
            />
            <p className="mt-1 text-[11px] text-gray-500">{t('settings.labels.publicBaseUrl.help')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.labels.defaultGrams.label')}</label>
            <input
              className="w-full p-2 border rounded-lg text-base"
              inputMode="decimal"
              value={labelDefaultGramsInput}
              onChange={(e) => setLabelDefaultGramsInput(e.target.value)}
              placeholder={t('settings.labels.defaultGrams.placeholder')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.labels.defaultCount.label')}</label>
            <input
              className="w-full p-2 border rounded-lg text-base"
              inputMode="numeric"
              value={labelDefaultCountInput}
              onChange={(e) => setLabelDefaultCountInput(e.target.value)}
              placeholder={t('settings.labels.defaultCount.placeholder')}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap"
            onClick={saveLabelSettings}
          >
            {t('settings.labels.save')}
          </button>
          {supportsNativeLabelPrint && (
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
              onClick={() => void handleTestPrint()}
              disabled={testPrintBusy}
            >
              {testPrintBusy ? t('settings.labels.testPrinting') : t('settings.labels.testPrint')}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500">
          {supportsNativeLabelPrint ? t('settings.labels.testHelp.native') : t('settings.labels.testHelp.web')}
        </p>
        {labelMsg && (
          <p
            className={`text-xs rounded-lg border p-2 whitespace-pre-line ${
              labelMsg.tone === 'error'
                ? 'text-red-700 bg-red-50 border-red-100'
                : 'text-amber-800 bg-amber-50 border-amber-200'
            }`}
          >
            {labelMsg.text}
          </p>
        )}
      </section>

      {canManageGuestBackup && (
        <section className="p-4 border-b border-gray-100 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">{t('settings.backup.title')}</h2>
          <p className="text-xs text-gray-500">{t('settings.backup.description')}</p>
          <p className="text-[11px] text-gray-500">
            {t('settings.backup.summary', {
              beans: localData.beans.length,
              brews: localData.brews.length,
              labels: localData.beanLabels.length,
            })}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap disabled:bg-gray-300"
              onClick={handleExportBackup}
              disabled={!localHasData()}
            >
              {t('settings.backup.export')}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
              onClick={() => restoreInputRef.current?.click()}
            >
              {t('settings.backup.import')}
            </button>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleRestoreBackupFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {backupMsg && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{backupMsg}</p>}
        </section>
      )}

      {/* Account / Auth */}
      <section className="p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.account.title')}</h2>

        {user && !isGuest && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              {t('logging.loggedInAs')} <span className="font-medium text-gray-900">{user.id}</span>
            </p>
            {localHasData() && (
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300 whitespace-nowrap"
                onClick={handleMigrateData}
                disabled={migrating}
              >
                {migrating ? t('guest.migrate.migrating') : t('guest.migrate.button')}
              </button>
            )}
            {migrateMsg && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{migrateMsg}</p>
            )}
            <button
              type="button"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
              onClick={async () => {
                try {
                  await logout();
                } catch {}
                onLogout();
              }}
            >
              {t('logging.logout')}
            </button>
          </div>
        )}

        {isGuest && (
          <div className="space-y-2">
            <p className="text-sm text-amber-800">{t('guest.banner')}</p>
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800"
                onClick={() => {
                  onExitGuest();
                  setAuthTab('signup');
                }}
              >
                {t('guest.banner.signup')}
              </button>
            )}
            <button type="button" className="w-full px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50" onClick={onExitGuest}>
              {t('guest.exit')}
            </button>
          </div>
        )}

        {!user && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-lg text-sm border ${
                  authTab === 'login' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200'
                }`}
                onClick={() => setAuthTab('login')}
              >
                {t('auth.tab.login')}
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-lg text-sm border ${
                  authTab === 'signup' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200'
                }`}
                onClick={() => setAuthTab('signup')}
              >
                {t('auth.tab.signup')}
              </button>
            </div>
            {authTab === 'login' ? (
              <LoginPage onLoggedIn={onAuthSuccess} />
            ) : (
              <SignupPage onSignedUp={onAuthSuccess} />
            )}
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="w-full text-sm text-gray-500 hover:text-amber-700 underline underline-offset-2"
                onClick={onEnterGuest}
              >
                {t('guest.button')}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
