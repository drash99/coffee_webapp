import { useMemo } from 'react';
import { Scatter, Bar } from 'react-chartjs-2';

interface ResultsDisplayProps {
  mode: 'bean' | 'grind';
  data: any[];
  loading?: boolean;
}

export function ResultsDisplay({ mode, data, loading }: ResultsDisplayProps) {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    
    if (mode === 'grind') {
      const sizes = data.map(d => d.majorMm * 1000); // Convert to um
      return {
        count: data.length,
        mean: sizes.reduce((a, b) => a + b, 0) / sizes.length,
        median: [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)],
        stdev: Math.sqrt(sizes.reduce((sq, n) => sq + Math.pow(n - (sizes.reduce((a, b) => a + b, 0) / sizes.length), 2), 0) / sizes.length)
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

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Processing image...</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0 || !stats) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <p className="text-gray-500 text-center py-4">No data to display. Upload an image to analyze.</p>
      </div>
    );
  }

  if (mode === 'grind') {
    // Grind: Size distribution histogram
    const sizes = data.map(d => d.majorMm * 1000); // um
    const bins = 20;
    const binSize = 2000 / bins;
    const histogram: number[] = new Array(bins).fill(0);
    
    sizes.forEach(size => {
      if (size >= 0 && size <= 2000) {
        const bin = Math.min(Math.floor(size / binSize), bins - 1);
        histogram[bin]++;
      }
    });
    
    const binCenters = Array.from({length: bins}, (_, i) => (i + 0.5) * binSize);
    const density = histogram.map(count => (count / sizes.length) * 100);
    
    const chartData = {
      labels: binCenters.map(x => `${x.toFixed(0)}μm`),
      datasets: [{
        label: 'Density (%)',
        data: density,
        backgroundColor: 'rgba(139, 69, 19, 0.7)',
        borderColor: 'rgba(139, 69, 19, 1)',
        borderWidth: 1
      }]
    };
    
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">Grind Analysis Results</h2>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-xs text-amber-800">Count</div>
            <div className="text-2xl font-bold text-amber-900">{stats.count}</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-800">Mean (μm)</div>
            <div className="text-2xl font-bold text-blue-900">{stats.mean.toFixed(1)}</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-800">Std Dev (μm)</div>
            <div className="text-2xl font-bold text-green-900">{stats.stdev.toFixed(1)}</div>
          </div>
        </div>
        
        <div className="h-64">
          <Bar 
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { title: { display: true, text: 'Particle Size (μm)' } },
                y: { title: { display: true, text: 'Density (%)' }, beginAtZero: true }
              },
              plugins: {
                legend: { display: false }
              }
            }}
          />
        </div>
        
        <div className="text-sm text-gray-600">
          <p>Median: {stats.median.toFixed(1)}μm</p>
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
        label: 'Beans',
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
        label: 'Count',
        data: lumaHist,
        backgroundColor: 'rgba(139, 69, 19, 0.7)',
        borderColor: 'rgba(139, 69, 19, 1)',
        borderWidth: 1
      }]
    };
    
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">Bean Analysis Results</h2>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-xs text-amber-800">Count</div>
            <div className="text-2xl font-bold text-amber-900">{stats.count}</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-800">Avg Size (mm)</div>
            <div className="text-2xl font-bold text-blue-900">{stats.sizeMean.toFixed(2)}</div>
            <div className="text-xs text-blue-600">±{stats.sizeStdev.toFixed(2)}</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-xs text-purple-800">Avg Lightness</div>
            <div className="text-2xl font-bold text-purple-900">{stats.lumaMean.toFixed(1)}</div>
            <div className="text-xs text-purple-600">±{stats.lumaStdev.toFixed(1)}</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-800">Roast Level</div>
            <div className="text-xl font-bold text-green-900">
              {stats.lumaMean > 150 ? 'Light' : stats.lumaMean > 100 ? 'Medium' : 'Dark'}
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
                  x: { title: { display: true, text: 'Major Axis (mm)' } },
                  y: { title: { display: true, text: 'Minor Axis (mm)' } }
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
                  x: { title: { display: true, text: 'Lightness (L)' } },
                  y: { title: { display: true, text: 'Count' }, beginAtZero: true }
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

