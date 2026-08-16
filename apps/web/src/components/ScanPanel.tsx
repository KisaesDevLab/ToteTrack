import { useState } from 'react';
import { useRescanBox } from '@/api/hooks';
import { CameraIcon, SparkIcon } from './AppShell';
import { PhotoUploader } from './PhotoUploader';
import { errorMessage, useToast } from '@/lib/toast';

/**
 * Guided capture used right after scanning a label (new box) and for "Rescan contents" when a box
 * has been repacked. All photos taken here go through one box-level AI analysis.
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
          ? 'Open the lid, take one or more photos of what is inside, and '
          : 'Contents changed? Take fresh photos and '}
        {aiAvailable ? (
          <>
            the AI will list the items and write a description automatically{' '}
            <SparkIcon className="inline h-3.5 w-3.5 text-accent-deep" />.
          </>
        ) : (
          'add the items yourself (AI analysis is off — enable it in Settings).'
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
      <PhotoUploader
        compact
        uploading={rescan.isPending}
        onUpload={(files) =>
          rescan.mutateAsync({ files, replace: mode === 'rescan' && replace }).then(
            (r) => {
              toast.success(
                r.aiQueued
                  ? `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} saved — AI is cataloguing the contents`
                  : `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} saved`,
              );
              onDone();
            },
            (err) => {
              toast.error(errorMessage(err));
              throw err;
            },
          )
        }
      />
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
