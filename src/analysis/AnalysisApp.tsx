import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import { ImageUpload } from '../components/ImageUpload';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { useI18n } from '../i18n/I18nProvider';
import { isSupabaseConfigured, getSupabaseClient } from '../config/supabase';
import { loadSession } from '../logging/session';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

export function AnalysisApp() {
  const { t } = useI18n();
  const [dose, setDose] = useState<number>(18.0);
  const [yieldWeight, setYieldWeight] = useState<number>(40.0);
  const [tds, setTds] = useState<number>(1.35);
  const [extPct, setExtPct] = useState<number>(0);

  // Worker reference
  const workerRef = useRef<Worker | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const [measuredRulerMm, setMeasuredRulerMm] = useState<number>(100.0);
  const [analysisMode, setAnalysisMode] = useState<'bean' | 'grind' | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [processing, setProcessing] = useState(false);

  const [grinderMaker, setGrinderMaker] = useState('');
  const [grinderModel, setGrinderModel] = useState('');
  const [grinderSetting, setGrinderSetting] = useState('');
  const [medianOverrideUm, setMedianOverrideUm] = useState<string>('');
  const [mapSaving, setMapSaving] = useState(false);
  const [mapMsg, setMapMsg] = useState<string | null>(null);

  const user = useMemo(() => loadSession(), []);

  useEffect(() => {
    // Calculate Extraction %: (Yield * TDS) / Dose
    const extraction = (yieldWeight * tds) / dose;
    setExtPct(parseFloat(extraction.toFixed(2)));
  }, [dose, yieldWeight, tds]);

  useEffect(() => {
    // Initialize OpenCV Worker
    workerRef.current = new Worker(new URL('../workers/cv.worker.ts', import.meta.url), {
      type: 'module'
    });

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'CV_READY') {
        setCvReady(true);
      } else if (type === 'ANALYSIS_COMPLETE') {
        setAnalysisResults(payload);
        setProcessing(false);
      } else if (type === 'ERROR') {
        console.error('CV Error:', payload);
        alert(t('analysis.alert.errorPrefix', { message: String(payload) }));
        setProcessing(false);
      } else if (type === 'DEBUG') {
        console.log('Worker DEBUG:', payload);
      }
    };

    workerRef.current.postMessage({ type: 'INIT' });

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleImageSelect = async (file: File, mode: 'bean' | 'grind') => {
    if (!cvReady) {
      alert(t('analysis.alert.cvNotReady'));
      return;
    }

    setProcessing(true);
    setAnalysisMode(mode);
    setAnalysisResults(null);

    // Read image file
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      // Create canvas to get ImageData
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setProcessing(false);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Send to worker
      workerRef.current?.postMessage({
        type: 'PROCESS_IMAGE',
        payload: {
          imageData,
          width: img.width,
          height: img.height,
          rulerLengthMm: measuredRulerMm,
          mode
        }
      });

      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      alert(t('analysis.alert.failedLoadImage'));
      setProcessing(false);
      URL.revokeObjectURL(url);
    };

    img.src = url;
  };

  const grindMedianUm = useMemo<number | null>(() => {
    if (analysisMode !== 'grind') return null;
    const particles = analysisResults?.mode === 'grind' ? analysisResults?.particles : null;
    if (!particles || !Array.isArray(particles) || particles.length === 0) return null;
    const sizes = particles
      .map((p: any) => Number(p?.majorMm) * 1000)
      .filter((n: number) => Number.isFinite(n));
    if (sizes.length === 0) return null;
    const sorted = [...sizes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  }, [analysisMode, analysisResults]);

  useEffect(() => {
    if (analysisMode !== 'grind') return;
    if (grindMedianUm == null) return;
    // default the override to the computed median (user can still edit)
    setMedianOverrideUm(String(Math.round(grindMedianUm)));
  }, [analysisMode, grindMedianUm]);

  async function getOrCreateGrinderUid(userUid: string, makerRaw: string, modelRaw: string): Promise<string> {
    const maker = makerRaw.trim();
    const model = modelRaw.trim();
    if (!maker || !model) throw new Error(t('grindMap.error.missingGrinder'));

    const supabase = getSupabaseClient();
    const { data: found, error: foundErr } = await supabase
      .from('grinders')
      .select('uid')
      .eq('user_uid', userUid)
      .ilike('maker', maker)
      .ilike('model', model)
      .maybeSingle();
    if (foundErr) throw new Error(foundErr.message);
    if (found?.uid) return found.uid as string;

    const uid = crypto.randomUUID();
    const { error: insertErr } = await supabase.from('grinders').insert({
      uid,
      user_uid: userUid,
      maker,
      model
    });
    if (insertErr) throw new Error(insertErr.message);
    return uid;
  }

  async function saveParticleSize() {
    setMapMsg(null);
    if (!isSupabaseConfigured()) {
      setMapMsg(t('analysis.grindMap.supabaseNotConfigured'));
      return;
    }
    if (!user?.uid) {
      setMapMsg(t('analysis.grindMap.loginRequired'));
      return;
    }
    if (analysisMode !== 'grind' || grindMedianUm == null) {
      setMapMsg(t('analysis.grindMap.noGrindData'));
      return;
    }
    const setting = grinderSetting.trim();
    if (!setting) {
      setMapMsg(t('grindMap.error.missingSetting'));
      return;
    }
    const median = (() => {
      const raw = medianOverrideUm.trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })();
    if (median == null) {
      setMapMsg(t('grindMap.error.missingMedian'));
      return;
    }

    setMapSaving(true);
    try {
      const supabase = getSupabaseClient();
      const grinder_uid = await getOrCreateGrinderUid(user.uid, grinderMaker, grinderModel);
      const { error: insErr } = await supabase.from('grinder_particle_sizes').insert({
        uid: crypto.randomUUID(),
        user_uid: user.uid,
        grinder_uid,
        grinder_setting: setting,
        particle_median_um: median
      });
      if (insErr) throw new Error(insErr.message);
      setMapMsg(t('grindMap.saved'));
    } catch (e) {
      setMapMsg(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setMapSaving(false);
    }
  }

  const chartData = {
    datasets: [
      {
        label: t('results.chart.currentBrew'),
        data: [{ x: tds, y: extPct }],
        backgroundColor: 'rgba(255, 99, 132, 1)'
      },
      {
        label: t('results.chart.idealZone'),
        data: [
          { x: 1.2, y: 18 },
          { x: 1.5, y: 22 }
        ],
        showLine: true,
        borderColor: 'rgba(75, 192, 192, 0.2)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true,
        pointRadius: 0
      }
    ]
  };

  const chartOptions = {
    scales: {
      x: {
        type: 'linear' as const,
        position: 'bottom' as const,
        title: { display: true, text: t('analysis.chart.tds') },
        min: 0.5,
        max: 2.0
      },
      y: {
        title: { display: true, text: t('analysis.chart.extraction') },
        min: 10,
        max: 30
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div
          className={`text-xs px-2 py-1 rounded-full ${
            cvReady ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {t('analysis.cv.label', { status: cvReady ? t('analysis.cv.ready') : t('analysis.cv.loading') })}
        </div>
      </div>

      <div className="max-w-md mx-auto space-y-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800">{t('calibration.title')}</h2>
            <div className="flex items-center gap-2">
              <a
                href={import.meta.env.DEV ? `${import.meta.env.BASE_URL ?? '/'}calibration_target.pdf` : 'https://raw.githubusercontent.com/drash99/drash99.github.io/main/calibration_target.pdf'}
                target="_blank"
                rel="noopener noreferrer"
                download="calibration_target.pdf"
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800"
              >
                {t('calibration.download.letter')}
              </a>
              <a
                href={import.meta.env.DEV ? `${import.meta.env.BASE_URL ?? '/'}calibration_target_a4.pdf` : 'https://raw.githubusercontent.com/drash99/drash99.github.io/main/calibration_target_a4.pdf'}
                target="_blank"
                rel="noopener noreferrer"
                download="calibration_target_a4.pdf"
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
              >
                {t('calibration.download.a4')}
              </a>
            </div>
          </div>
          <div className="text-xs text-gray-500">{t('calibration.note')}</div>
        </div>

        {/* Extraction Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" /> {t('analysis.extraction.title')}
          </h2>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('analysis.field.dose')}</label>
              <input
                type="number"
                value={dose}
                onChange={(e) => setDose(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('analysis.field.yield')}</label>
              <input
                type="number"
                value={yieldWeight}
                onChange={(e) => setYieldWeight(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('analysis.field.tds')}</label>
              <input
                type="number"
                value={tds}
                onChange={(e) => setTds(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg"
                step="0.01"
              />
            </div>
          </div>

          <div className="text-center p-4 bg-amber-50 rounded-lg">
            <div className="text-sm text-amber-800">{t('analysis.extractionYield')}</div>
            <div className="text-3xl font-bold text-amber-900">{extPct}%</div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <Scatter options={chartOptions} data={chartData} />
        </div>

        {/* Calibration Input */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('analysis.calibration.label')}
          </label>
          <input
            type="number"
            value={measuredRulerMm}
            onChange={(e) => setMeasuredRulerMm(parseFloat(e.target.value) || 100)}
            className="w-full p-2 border rounded-lg bg-gray-50"
            placeholder="100.0"
            disabled={processing}
          />
          <p className="text-xs text-gray-400 mt-1">
            {t('analysis.calibration.help')}
          </p>
        </div>

        {/* Image Upload Buttons */}
        <div className="grid grid-cols-2 gap-4">
          <ImageUpload
            mode="bean"
            onImageSelect={(file) => handleImageSelect(file, 'bean')}
            disabled={!cvReady || processing}
          />
          <ImageUpload
            mode="grind"
            onImageSelect={(file) => handleImageSelect(file, 'grind')}
            disabled={!cvReady || processing}
          />
        </div>

        {/* Results Display */}
        {analysisMode && (
          <ResultsDisplay
            mode={analysisMode}
            data={
              analysisResults?.mode === analysisMode
                ? analysisMode === 'grind'
                  ? analysisResults.particles
                  : analysisResults.beans
                : []
            }
            {...(analysisResults?.stageImageData && { stageImageData: analysisResults.stageImageData })}
            {...(analysisResults?.warpedImageData && { warpedImageData: analysisResults.warpedImageData })}
            {...(analysisResults?.lutCurves && { lutCurves: analysisResults.lutCurves })}
            loading={processing}
          />
        )}

        {/* Grinder particle size mapping (below results graphs) */}
        {analysisMode === 'grind' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-3">
            <h2 className="text-lg font-semibold">{t('analysis.grindMap.title')}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.maker')}</label>
                <input
                  className="w-full p-2 border rounded-lg"
                  value={grinderMaker}
                  onChange={(e) => setGrinderMaker(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.model')}</label>
                <input
                  className="w-full p-2 border rounded-lg"
                  value={grinderModel}
                  onChange={(e) => setGrinderModel(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.setting')}</label>
                <input
                  className="w-full p-2 border rounded-lg"
                  value={grinderSetting}
                  onChange={(e) => setGrinderSetting(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('grindMap.field.particleMedianUm')}</label>
                <input
                  className="w-full p-2 border rounded-lg"
                  type="number"
                  step="1"
                  value={medianOverrideUm}
                  onChange={(e) => setMedianOverrideUm(e.target.value)}
                  placeholder={t('grindMap.placeholder.particleMedianUm')}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {grindMedianUm == null ? t('analysis.grindMap.noGrindData') : `median ≈ ${Math.round(grindMedianUm)} μm`}
                </div>
              </div>
            </div>

            {mapMsg && <div className="text-xs text-gray-600">{mapMsg}</div>}

            <button
              type="button"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:bg-gray-300"
              onClick={saveParticleSize}
              disabled={mapSaving}
            >
              {mapSaving ? t('grindMap.save.saving') : t('grindMap.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


