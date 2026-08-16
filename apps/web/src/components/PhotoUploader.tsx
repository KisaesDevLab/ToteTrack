import { useRef, useState } from 'react';
import { CameraIcon } from './AppShell';
import { Spinner } from './ui';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

export function PhotoUploader({
  onUpload,
  uploading,
  compact,
}: {
  onUpload: (files: File[]) => Promise<unknown>;
  uploading: boolean;
  compact?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (list: FileList | null) => {
    setError(null);
    if (!list || !list.length) return;
    const files = Array.from(list);
    if (files.length > MAX_FILES) {
      setError(`Choose at most ${MAX_FILES} photos at a time`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 20 MB`);
      return;
    }
    try {
      await onUpload(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (cameraRef.current) cameraRef.current.value = '';
      if (libraryRef.current) libraryRef.current.value = '';
    }
  };

  return (
    <div className={compact ? 'flex gap-2' : 'card p-3'}>
      {!compact && <div className="mb-2 text-sm font-semibold">Photos</div>}
      <div className="flex gap-2">
        {/* capture="environment" opens the rear camera directly on phones */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handle(e.target.files)}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handle(e.target.files)}
        />
        <button
          type="button"
          className="btn-accent flex-1"
          disabled={uploading}
          onClick={() => cameraRef.current?.click()}
        >
          {uploading ? <Spinner className="h-4 w-4" /> : <CameraIcon className="h-4 w-4" />}
          Take photo
        </button>
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={uploading}
          onClick={() => libraryRef.current?.click()}
        >
          Choose photos
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {!compact && (
        <p className="mt-2 text-xs text-ink-mute">
          JPEG, PNG or WebP up to 20 MB each (up to 20 at a time). Photos are analyzed automatically
          when AI is enabled.
        </p>
      )}
    </div>
  );
}
