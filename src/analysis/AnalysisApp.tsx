import { useState, useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import { ImageUpload } from '../components/ImageUpload';
import { ResultsDisplay } from '../components/ResultsDisplay';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

export function AnalysisApp() {
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
        alert(`Error: ${payload}`);
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
      alert('OpenCV is not ready yet. Please wait...');
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
      alert('Failed to load image');
      setProcessing(false);
      URL.revokeObjectURL(url);
    };

    img.src = url;
  };

  const chartData = {
    datasets: [
      {
        label: 'Current Brew',
        data: [{ x: tds, y: extPct }],
        backgroundColor: 'rgba(255, 99, 132, 1)'
      },
      {
        label: 'Ideal Zone',
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
        title: { display: true, text: 'TDS %' },
        min: 0.5,
        max: 2.0
      },
      y: {
        title: { display: true, text: 'Extraction %' },
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
          CV: {cvReady ? 'Ready' : 'Loading...'}
        </div>
      </div>

      <div className="max-w-md mx-auto space-y-6">
        {/* Extraction Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" /> Extraction
          </h2>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Dose (g)</label>
              <input
                type="number"
                value={dose}
                onChange={(e) => setDose(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Yield (g)</label>
              <input
                type="number"
                value={yieldWeight}
                onChange={(e) => setYieldWeight(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">TDS (%)</label>
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
            <div className="text-sm text-amber-800">Extraction Yield</div>
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
            Calibration: Measured Length of 10cm Line (mm)
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
            Measure the "10 cm Scale" on your printed sheet to correct for printer scaling.
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
      </div>
    </div>
  );
}


