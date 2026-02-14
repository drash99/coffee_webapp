import { useMemo, useState, useEffect } from 'react';
import { Scatter, Bar, Line } from 'react-chartjs-2';
import { useI18n } from '../i18n/I18nProvider';

/** Image bytes from the worker — Uint8Array is 8× smaller than number[]. */
type ImageBytes = { data: Uint8Array | number[]; width: number; height: number };

export interface ResultsDisplayProps {
  mode: 'bean' | 'grind';
  data: any[];
  stageImageData?: ImageBytes;
  warpedImageData?: ImageBytes;
  lutCurves?: { r: number[]; g: number[]; b: number[] };
  loading?: boolean;
}

interface Particle {
  majorMm: number;
  minorMm: number;
  areaPx: number;
  surfaceMm2?: number;
  volMm3?: number;
  attainableVol?: number; // proportional to available mass
  ey?: number;
  luma?: number;
}

type HistogramType = 
  | 'num_diam' | 'num_surf' | 'num_vol'
  | 'mass_diam' | 'mass_surf' | 'mass_vol'
  | 'av_mass_diam' | 'av_mass_surf' | 'av_mass_vol'
  | 'surf_diam' | 'surf_surf' | 'surf_vol';

const HISTOGRAM_OPTIONS: { value: HistogramType; label: string }[] = [
  { value: 'num_diam', label: 'Number vs Diameter' },
  { value: 'num_surf', label: 'Number vs Surface' },
  { value: 'num_vol', label: 'Number vs Volume' },
  { value: 'mass_diam', label: 'Mass vs Diameter' },
  { value: 'mass_surf', label: 'Mass vs Surface' },
  { value: 'mass_vol', label: 'Mass vs Volume' },
  { value: 'av_mass_diam', label: 'Available Mass vs Diameter' },
  { value: 'av_mass_surf', label: 'Available Mass vs Surface' },
  { value: 'av_mass_vol', label: 'Available Mass vs Volume' },
  { value: 'surf_diam', label: 'Surface vs Diameter' },
  { value: 'surf_surf', label: 'Surface vs Surface' },
  { value: 'surf_vol', label: 'Surface vs Volume' },
];

/** Convert worker image bytes to a blob URL for display.
 *  Uses blob URL (cheap pointer) instead of base64 data URL (33% larger string copy). */
function useImageBlobUrl(imageData: ImageBytes | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageData?.data?.length || !imageData.width || !imageData.height) {
      setUrl(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const clamped = new Uint8ClampedArray(imageData.data);
    const idata = new ImageData(clamped, imageData.width, imageData.height);
    ctx.putImageData(idata, 0, 0);
    // Use blob URL instead of base64 data URL — avoids a huge string copy
    canvas.toBlob((blob) => {
      if (blob) setUrl(URL.createObjectURL(blob));
    }, 'image/png');
    // Free canvas memory
    canvas.width = 0;
    canvas.height = 0;
    return () => {
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [imageData]);
  return url;
}

export function ResultsDisplay({ mode, data, stageImageData, warpedImageData, lutCurves, loading }: ResultsDisplayProps) {
  const { t } = useI18n();
  const stageImageUrl = useImageBlobUrl(stageImageData);
  const warpedImageUrl = useImageBlobUrl(warpedImageData);
  const [histogramType, setHistogramType] = useState<HistogramType>('av_mass_diam');

  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    
    if (mode === 'grind') {
      const particles = data as Particle[];
      const sizes = particles.map(d => d.majorMm); // in mm

      // Weighted mean / stdev using attainable volume as weights (similar spirit to Gagné's code)
      const weights = particles.map(p => p.attainableVol ?? 1);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const weightedMean = particles.reduce((acc, p, i) => acc + p.majorMm * weights[i], 0) / totalWeight;

      const variance = particles.reduce(
        (acc, p, i) => acc + weights[i] * Math.pow(p.majorMm - weightedMean, 2),
        0
      ) / totalWeight;
      const weightedStdev = Math.sqrt(variance);

      // Peak (mode) using 50µm (0.05mm) bins
      let modeUm = Number.NaN;
      if (sizes.length > 0) {
        const binSizeMm = 0.05; // 50 µm
        let minSize = Math.min(...sizes);
        let maxSize = Math.max(...sizes);

        if (!isFinite(minSize) || !isFinite(maxSize) || minSize === maxSize) {
          // Fallback: use weighted mean if distribution is degenerate
          modeUm = weightedMean * 1000;
        } else {
          // Small padding to be safe
          minSize = Math.max(0, minSize - binSizeMm * 0.5);
          maxSize = maxSize + binSizeMm * 0.5;
          const binCount = Math.ceil((maxSize - minSize) / binSizeMm);
          const binWeights = new Array(binCount).fill(0);

          particles.forEach((p) => {
            const idx = Math.floor((p.majorMm - minSize) / binSizeMm);
            if (idx >= 0 && idx < binCount) binWeights[idx] += (p.attainableVol ?? 0);
          });

          const peakIdx = binWeights.indexOf(Math.max(...binWeights));
          const modeMm = minSize + (peakIdx + 0.5) * binSizeMm;
          modeUm = modeMm * 1000;
        }
      }

      return {
        count: data.length,
        mean: weightedMean * 1000, // µm
        stdev: weightedStdev * 1000,
        mode: modeUm
      };
    } else {
      const majorSizes = data.map(d => d.majorMm);
      const lumas = data.map(d => d.luma);
      return {
        count: data.length,
        sizeMean: majorSizes.reduce((a, b) => a + b, 0) / majorSizes.length,
        sizeStdev: Math.sqrt(majorSizes.reduce((sq, n) => sq + Math.pow(n - (majorSizes.reduce((a, b) => a + b, 0) / majorSizes.length), 2), 0) / majorSizes.length),
        lumaMean: lumas.reduce((a, b) => a + b, 0) / lumas.length,
        lumaStdev: Math.sqrt(lumas.reduce((sq, n) => sq + Math.pow(n - (lumas.reduce((a, b) => a + b, 0) / lumas.length), 2), 0) / lumas.length)
      };
    }
  }, [data, mode]);

  const histogramData = useMemo(() => {
    if (mode !== 'grind' || !data || data.length === 0) return null;
    const particles = data as Particle[];

    // 1. Select X Data and Label
    let xData: number[] = [];
    let xLabel = '';
    
    if (histogramType.includes('diam')) {
      xData = particles.map(p => p.majorMm); // Diameter in mm
      xLabel = 'Particle Diameter (mm)';
    } else if (histogramType.includes('surf')) {
      xData = particles.map(p => p.surfaceMm2 ?? 0);
      xLabel = 'Particle Surface (mm²)';
    } else if (histogramType.includes('vol')) {
      xData = particles.map(p => p.volMm3 ?? 0);
      xLabel = 'Particle Volume (mm³)';
    }

    // 2. Select Weights and Y Label
    let weights: number[] = [];
    let yLabel = '';

    if (histogramType.startsWith('num_')) {
      weights = particles.map(() => 1);
      yLabel = 'Fraction of Particles';
    } else if (histogramType.startsWith('mass_')) {
      weights = particles.map(p => p.volMm3 ?? 0); // Mass proportional to Volume
      yLabel = 'Fraction of Total Mass';
    } else if (histogramType.startsWith('av_mass_')) {
      weights = particles.map(p => p.attainableVol ?? 0);
      yLabel = 'Fraction of Available Mass';
    } else if (histogramType.startsWith('surf_')) {
      weights = particles.map(p => p.surfaceMm2 ?? 0);
      yLabel = 'Fraction of Total Surface';
    }

    // 3. Binning
    const isDiameter = histogramType.includes('diam');
    // User requested 100um grid (linear) for diameter.
    // Using 100µm linear grid for diameter (no log bins).
    
    let minX = Math.min(...xData.filter(x => x > 0));
    let maxX = Math.max(...xData);
    
    if (minX === Infinity) minX = 0.01;
    if (maxX === -Infinity) maxX = 10;

    const binEdges: number[] = [];
    let bins = 0;

    if (isDiameter) {
      // 100um grid = 0.1mm
      const gridSize = 0.1;
      // Align to grid
      minX = Math.floor(minX / gridSize) * gridSize;
      maxX = Math.ceil(maxX / gridSize) * gridSize;
      if (maxX <= minX) maxX = minX + gridSize;
      
      bins = Math.round((maxX - minX) / gridSize);
      for (let i = 0; i <= bins; i++) {
        binEdges.push(minX + i * gridSize);
      }
    } else {
      // For other metrics, use a reasonable fixed number of bins (e.g. 20)
      bins = 20;
      if (minX <= 0) minX = 0;
      const step = (maxX - minX) / bins;
      for (let i = 0; i <= bins; i++) {
        binEdges.push(minX + i * step);
      }
    }

    const binCounts = new Array(bins).fill(0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < xData.length; i++) {
      const val = xData[i];
      const weight = weights[i];
      if (val < minX || val > maxX) continue;

      // Find bin
      let binIdx = -1;
      if (isDiameter) {
        // Linear grid 0.1mm
        binIdx = Math.floor((val - minX) / 0.1);
      } else {
        const step = (maxX - minX) / bins;
        binIdx = Math.floor((val - minX) / step);
      }

      if (binIdx >= 0 && binIdx < bins) {
        binCounts[binIdx] += weight;
      }
    }

    // Normalize to fraction
    const density = binCounts.map(w => (w / totalWeight) * 100);
    
    // Labels for chart (bin centers)
    const labels = [];
    for (let i = 0; i < bins; i++) {
      const start = binEdges[i];
      const end = binEdges[i+1];
      const center = (start + end) / 2;
      // Format label
      if (histogramType.includes('diam')) {
        labels.push((center * 1000).toFixed(0)); // um for diameter
      } else {
        labels.push(center.toFixed(2));
      }
    }

    return {
      labels,
      datasets: [{
        label: yLabel,
        data: density,
        backgroundColor: 'rgba(139, 69, 19, 0.7)',
        borderColor: 'rgba(139, 69, 19, 1)',
        borderWidth: 1
      }],
      xLabel: histogramType.includes('diam') ? 'Particle Diameter (μm)' : xLabel,
      yLabel
    };

  }, [data, mode, histogramType]);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('results.processing')}</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0 || !stats) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <p className="text-gray-500 text-center py-4">{t('results.noData')}</p>
      </div>
    );
  }

  if (mode === 'grind') {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">{t('results.grind.title')}</h2>
        </div>

        {stageImageUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 px-2 py-1">{t('results.debug.stageParticles')}</p>
            <img src={stageImageUrl} alt={t('results.alt.stageParticles')} className="w-full h-auto max-h-80 object-contain" />
          </div>
        )}
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-xs text-amber-800">{t('results.stat.count')}</div>
            <div className="text-2xl font-bold text-amber-900">{stats.count}</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-800">{t('results.stat.meanUm')} (Weighted)</div>
            <div className="text-2xl font-bold text-blue-900">{(stats.mean ?? 0).toFixed(1)}</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-800">{t('results.stat.stdevUm')} (Weighted)</div>
            <div className="text-2xl font-bold text-green-900">{(stats.stdev ?? 0).toFixed(1)}</div>
          </div>
        </div>
        
        <div className="h-64">
          {histogramData && (
            <Bar 
              data={histogramData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { title: { display: true, text: histogramData.xLabel } },
                  y: { title: { display: true, text: histogramData.yLabel }, beginAtZero: true }
                },
                plugins: {
                  legend: { display: false }
                }
              }}
            />
          )}
        </div>
        
        <div className="flex justify-between items-center text-sm text-gray-600">
          <p>Peak (mode): {(stats.mode ?? 0).toFixed(1)}µm</p>
          <select 
            value={histogramType} 
            onChange={(e) => setHistogramType(e.target.value as HistogramType)}
            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          >
            {HISTOGRAM_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
          <p>Based on the research of Jonathan Gagné</p>
          <a 
            href="https://coffeeadastra.com/2019/04/07/an-app-to-measure-your-coffee-grind-size-distribution-2/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            An App to Measure your Coffee Grind Size Distribution
          </a>
        </div>
      </div>
    );
  } else {
    // Bean: Size scatter + Color histogram
    const majorSizes = data.map(d => d.majorMm);
    const minorSizes = data.map(d => d.minorMm);
    const lumas = data.map(d => d.luma);
    
    const scatterData = {
      datasets: [{
        label: t('results.dataset.beans'),
        data: majorSizes.map((maj, i) => ({ x: maj, y: minorSizes[i] })),
        backgroundColor: 'rgba(139, 69, 19, 0.6)',
        pointRadius: 4
      }]
    };
    
    const lumaBins = 20;
    const lumaHist: number[] = new Array(lumaBins).fill(0);
    lumas.forEach(l => {
      const bin = Math.min(Math.floor((l / 255) * lumaBins), lumaBins - 1);
      lumaHist[bin]++;
    });
    
    const lumaBinCenters = Array.from({length: lumaBins}, (_, i) => ((i + 0.5) / lumaBins) * 255);
    
    const lumaChartData = {
      labels: lumaBinCenters.map(x => x.toFixed(0)),
      datasets: [{
        label: t('results.stat.count'),
        data: lumaHist,
        backgroundColor: 'rgba(139, 69, 19, 0.7)',
        borderColor: 'rgba(139, 69, 19, 1)',
        borderWidth: 1
      }]
    };
    
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">{t('results.bean.title')}</h2>

        {warpedImageUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 px-2 py-1">{t('results.debug.warped')}</p>
            <p className="text-xs text-gray-500 px-2 pb-1">{t('results.debug.warped.help')}</p>
            <img src={warpedImageUrl} alt={t('results.alt.warped')} className="w-full h-auto max-h-80 object-contain" />
          </div>
        )}
        {lutCurves && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
            <p className="text-xs text-gray-500 px-2 py-1">{t('results.debug.lut')}</p>
            <div className="h-48">
              <Line
                data={{
                  labels: Array.from({ length: 256 }, (_, i) => i),
                  datasets: [
                    { label: 'R', data: lutCurves.r, borderColor: 'rgb(220,53,69)', backgroundColor: 'rgba(220,53,69,0.1)', fill: false, pointRadius: 0 },
                    { label: 'G', data: lutCurves.g, borderColor: 'rgb(40,167,69)', backgroundColor: 'rgba(40,167,69,0.1)', fill: false, pointRadius: 0 },
                    { label: 'B', data: lutCurves.b, borderColor: 'rgb(0,123,255)', backgroundColor: 'rgba(0,123,255,0.1)', fill: false, pointRadius: 0 }
                  ]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { title: { display: true, text: t('results.axis.input') }, min: 0, max: 255 },
                    y: { title: { display: true, text: t('results.axis.output') }, min: 0, max: 255 }
                  },
                  plugins: { legend: { display: true } }
                }}
              />
            </div>
          </div>
        )}
        {stageImageUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 px-2 py-1">{t('results.debug.stageBeans')}</p>
            <img src={stageImageUrl} alt={t('results.alt.stageBeans')} className="w-full h-auto max-h-80 object-contain" />
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-xs text-amber-800">{t('results.stat.count')}</div>
            <div className="text-2xl font-bold text-amber-900">{stats.count}</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-800">{t('results.stat.avgSizeMm')}</div>
            <div className="text-2xl font-bold text-blue-900">{(stats.sizeMean ?? 0).toFixed(2)}</div>
            <div className="text-xs text-blue-600">±{(stats.sizeStdev ?? 0).toFixed(2)}</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-xs text-purple-800">{t('results.stat.avgLightness')}</div>
            <div className="text-2xl font-bold text-purple-900">{(stats.lumaMean ?? 0).toFixed(1)}</div>
            <div className="text-xs text-purple-600">±{(stats.lumaStdev ?? 0).toFixed(1)}</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-800">{t('results.stat.roastLevel')}</div>
            <div className="text-xl font-bold text-green-900">
              {(stats.lumaMean ?? 0) > 150 ? t('results.roast.light') : (stats.lumaMean ?? 0) > 100 ? t('results.roast.medium') : t('results.roast.dark')}
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="h-48">
            <Scatter 
              data={scatterData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { title: { display: true, text: t('results.axis.majorAxis') } },
                  y: { title: { display: true, text: t('results.axis.minorAxis') } }
                },
                plugins: {
                  legend: { display: false }
                }
              }}
            />
          </div>
          
          <div className="h-48">
            <Bar
              data={lumaChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { title: { display: true, text: t('results.axis.lightness') } },
                  y: { title: { display: true, text: t('results.stat.count') }, beginAtZero: true }
                },
                plugins: {
                  legend: { display: false }
                }
              }}
            />
          </div>
        </div>
      </div>
    );
  }
}
