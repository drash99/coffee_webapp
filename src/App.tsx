import { useState, type ReactNode } from 'react';
import { Coffee, Microscope, NotebookPen } from 'lucide-react';
import { AnalysisApp } from './analysis/AnalysisApp';
import { LoggingApp } from './logging/LoggingApp';

function App() {
  const [tab, setTab] = useState<'analysis' | 'logging'>('logging');

  function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
      <button
        type="button"
        className={`px-3 py-2 rounded-lg text-sm border flex items-center gap-2 ${
          active ? 'bg-amber-700 text-white border-amber-700' : 'bg-white hover:bg-gray-50 border-gray-200'
        }`}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Coffee className="w-8 h-8 text-amber-700" />
          BeanLog
        </h1>
        <div className="flex items-center gap-2">
          <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>
            <Microscope className="w-4 h-4" />
            Analysis
          </TabButton>
          <TabButton active={tab === 'logging'} onClick={() => setTab('logging')}>
            <NotebookPen className="w-4 h-4" />
            Logging
          </TabButton>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        {tab === 'analysis' ? <AnalysisApp /> : <LoggingApp />}
      </main>
    </div>
  );
}

export default App

