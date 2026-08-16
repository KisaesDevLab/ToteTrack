import { useEffect, useMemo, useRef, useState } from 'react';
import { useRescanBox } from '@/api/hooks';
import { CameraIcon, SparkIcon, TrashIcon } from './AppShell';
import { Spinner } from './ui';
import { errorMessage, useToast } from '@/lib/toast';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

/**
 * Guided capture used right after scanning a label (new box) and for "Rescan contents" when a box
 * has been repacked. Multi-shot: take several photos, then upload them together — one box-level
 * AI analysis covers all of them.
 */
export function ScanPanel({
  boxId,
  labelId,
  mode,
  hasPhotos,
  aiAvailable,
  onDone,
  onCancel,
}: {
  boxId: number;
  labelId: string;
  mode: 'capture' | 'rescan';
  hasPhotos: boolean;
  aiAvailable: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const rescan = useRescanBox(boxId);
  const toast = useToast();
  const [replace, setReplace] = useState(mode === 'rescan');
  const [queue, setQueue] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => queue.map((f) => URL.createObjectURL(f)), [queue]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | null) => {
    setError(null);
    if (!list?.length) return;
    const files = Array.from(list);
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setError(`${tooBig.name || 'A photo'} is larger than 20 MB`);
    setQueue((q) => [...q, ...files].slice(0, MAX_FILES));
    if (cameraRef.current) cameraRef.current.value = '';
    if (libraryRef.current) libraryRef.current.value = '';
  };

  const save = () => {
    if (!queue.length) return;
    rescan.mutate(
      { files: queue, replace: mode === 'rescan' && replace },
      {
        onSuccess: (r) => {
          toast.success(
            r.aiQueued
              ? `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} saved — AI is cataloguing the contents`
              : `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} saved`,
          );
          setQueue([]);
          onDone();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <div className="card border-accent/50 bg-accent-soft/30 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white">
          <CameraIcon className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold">
          {mode === 'capture' ? `Scan the contents of ${labelId}` : `Rescan ${labelId}`}
        </h2>
      </div>
      <p className="mb-3 text-sm text-ink-soft">
        {mode === 'capture'
          ? 'Open the lid, take a photo (or several), then save — '
          : 'Contents changed? Take fresh photos, then save — '}
        {aiAvailable ? (
          <>
            the AI lists the items and writes the description automatically{' '}
            <SparkIcon className="inline h-3.5 w-3.5 text-accent-deep" />.
          </>
        ) : (
          'then add the items yourself (AI analysis is off — enable it in Settings).'
        )}
      </p>

      {mode === 'rescan' && hasPhotos && (
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-accent"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          <span>
            Replace the previous photos and AI-suggested items
            <span className="block text-xs text-ink-mute">
              Items you added by hand are always kept. Untick to add these photos alongside the old
              ones.
            </span>
          </span>
        </label>
      )}

      {/* capture="environment" opens the rear camera directly on phones */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />

      {queue.length > 0 && (
        <ul className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Photos to upload">
          {queue.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative h-20 w-20 shrink-0">
              <img
                src={previews[i]}
                alt={`Photo ${i + 1}`}
                className="h-full w-full rounded-lg object-cover"
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-paper shadow-pop"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                disabled={rescan.isPending}
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={`${queue.length ? 'btn-secondary' : 'btn-accent'} flex-1`}
          disabled={rescan.isPending || queue.length >= MAX_FILES}
          onClick={() => cameraRef.current?.click()}
        >
          <CameraIcon className="h-4 w-4" /> {queue.length ? 'Take another' : 'Take photo'}
        </button>
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={rescan.isPending || queue.length >= MAX_FILES}
          onClick={() => libraryRef.current?.click()}
        >
          Choose photos
        </button>
      </div>
      {queue.length > 0 && (
        <button
          type="button"
          className="btn-primary mt-2 w-full"
          disabled={rescan.isPending}
          onClick={save}
        >
          {rescan.isPending ? <Spinner className="h-4 w-4" /> : <SparkIcon className="h-4 w-4" />}
          {rescan.isPending
            ? 'Uploading…'
            : `Save ${queue.length} photo${queue.length === 1 ? '' : 's'}${aiAvailable ? ' & analyze' : ''}`}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onCancel}
          disabled={rescan.isPending}
        >
          {mode === 'capture' ? 'Skip for now' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
