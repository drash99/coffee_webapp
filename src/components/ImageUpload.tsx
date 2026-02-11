import { useRef } from 'react';
import { Upload, Coffee, BarChart3 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface ImageUploadProps {
  mode: 'bean' | 'grind';
  onImageSelect: (file: File) => void;
  disabled?: boolean;
}

export function ImageUpload({ mode, onImageSelect, disabled }: ImageUploadProps) {
  const { t } = useI18n();
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
        {mode === 'bean' ? t('upload.bean.title') : t('upload.grind.title')}
      </h2>
      
      {/* Explicit MIME types instead of image/* to prevent iOS from
          bundling Live-Photo video data with the selected still image. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
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
        {t('upload.button', { mode: mode === 'bean' ? t('upload.mode.bean') : t('upload.mode.grind') })}
      </button>
      
      <p className="text-xs text-gray-500 mt-2 text-center">
        {t('upload.help', {
          modePlural: mode === 'bean' ? t('upload.modePlural.bean') : t('upload.modePlural.grind')
        })}
      </p>
    </div>
  );
}

