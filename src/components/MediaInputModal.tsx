import { useState, useRef } from 'react';
import { X, Link, Upload, Video, Image as ImageIcon } from 'lucide-react';
import { useMediaUpload } from '../hooks/useMediaUpload';

interface MediaInputModalProps {
  type: 'video' | 'image';
  onClose: () => void;
  onSave: (url: string) => void;
}

export function MediaInputModal({ type, onClose, onSave }: MediaInputModalProps) {
  const { uploadMedia } = useMediaUpload();
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [inputMethod, setInputMethod] = useState<'url' | 'upload'>('url');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVideo = type === 'video';
  const Icon = isVideo ? Video : ImageIcon;
  const title = isVideo ? 'Add Video' : 'Add Image';
  const acceptTypes = isVideo ? 'video/mp4,video/webm,video/ogg' : 'image/jpeg,image/png,image/gif,image/webp';
  const urlPlaceholder = isVideo
    ? 'https://youtube.com/watch?v=... or direct video URL'
    : 'https://example.com/image.jpg';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);

    // Generate preview for images
    if (type === 'image') {
      const reader = new FileReader();
      reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      const publicUrl = await uploadMedia(selectedFile, type);
      onSave(publicUrl);
    } catch (error) {
      alert(`Failed to upload ${type}. Please try again.`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  const handleSubmit = () => {
    if (inputMethod === 'url') {
      handleSubmitUrl();
    } else {
      handleUpload();
    }
  };

  const canSubmit =
    (inputMethod === 'url' && url.trim().length > 0) ||
    (inputMethod === 'upload' && selectedFile !== null);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Icon size={20} className={isVideo ? 'text-indigo-600' : 'text-pink-600'} />
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Input method toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setInputMethod('url')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors flex items-center justify-center gap-2 ${
                inputMethod === 'url'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Link size={14} />
              URL
            </button>
            <button
              onClick={() => setInputMethod('upload')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors flex items-center justify-center gap-2 ${
                inputMethod === 'upload'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Upload size={14} />
              Upload
            </button>
          </div>

          {inputMethod === 'url' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isVideo ? 'Video URL' : 'Image URL'}
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={urlPlaceholder}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) handleSubmit();
                }}
              />
              {isVideo && (
                <p className="mt-1 text-xs text-gray-500">
                  Supports YouTube, Vimeo, or direct video URLs (mp4, webm)
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Choose file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptTypes}
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-center"
              >
                {selectedFile ? selectedFile.name : `Click to select ${type} file...`}
              </button>
              {previewUrl && (
                <div className="mt-3">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-32 rounded-md border border-gray-200 object-contain"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || uploading}
            className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
              isVideo
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-pink-600 hover:bg-pink-700'
            }`}
          >
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Icon size={16} />
                {inputMethod === 'upload' ? `Upload ${type}` : `Add ${type}`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
