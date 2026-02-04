import { useState, useRef } from 'react';
import { Upload, Coffee, BarChart3 } from 'lucide-react';

interface ImageUploadProps {
  mode: 'bean' | 'grind';
  onImageSelect: (file: File) => void;
  disabled?: boolean;
}

export function ImageUpload({ mode, onImageSelect, disabled }: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelect(file);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        {mode === 'bean' ? <Coffee className="w-5 h-5" /> : <BarChart3 className="w-5 h-5" />}
        {mode === 'bean' ? 'Bean Analysis' : 'Grind Analysis'}
      </h2>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />
      
      <button
        onClick={handleClick}
        disabled={disabled}
        className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Upload className="w-5 h-5" />
        Upload {mode === 'bean' ? 'Bean' : 'Grind'} Image
      </button>
      
      <p className="text-xs text-gray-500 mt-2 text-center">
        Place {mode === 'bean' ? 'beans' : 'grinds'} on the calibration sheet stage
      </p>
    </div>
  );
}

