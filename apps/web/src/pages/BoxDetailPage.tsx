import type { BoxDetail } from '@totetrack/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useAnalyzeBox,
  useAnalyzePhoto,
  useBox,
  useBulkDeleteItems,
  useCreateItem,
  useDeleteBox,
  useDeleteItem,
  useDeletePhoto,
  useLocations,
  useReorderPhotos,
  useSettings,
  useToggleBoxStatus,
  useUpdateBox,
  useUpdateItem,
  useUploadPhotos,
} from '@/api/hooks';
import { CameraIcon, ChevronLeft, PrintIcon, SparkIcon } from '@/components/AppShell';
import { ItemList } from '@/components/ItemList';
import { PhotoGallery } from '@/components/PhotoGallery';
import { PhotoUploader } from '@/components/PhotoUploader';
import { ScanPanel } from '@/components/ScanPanel';
import {
  AiPill,
  EmptyState,
  ErrorNote,
  LabelChip,
  LockIcon,
  PageHeader,
  SkeletonList,
  Spinner,
  StatusPill,
} from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

export function BoxDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const [aiPolling, setAiPolling] = useState(false);
  const box = useBox(Number.isFinite(id) ? id : undefined, {
    refetchInterval: aiPolling ? 2500 : false,
  });

  useEffect(() => {
    const pending =
      box.data?.aiStatus === 'pending' || box.data?.photos.some((p) => p.aiStatus === 'pending');
    setAiPolling(Boolean(pending));
  }, [box.data]);

  if (!Number.isFinite(id)) return <EmptyState title="Invalid box" />;
  if (box.isPending) return <SkeletonList rows={3} />;
  if (box.isError) {
    return (
      <div className="space-y-3">
        <ErrorNote message={errorMessage(box.error)} retry={() => void box.refetch()} />
        <Link to="/boxes" className="btn-secondary">
          Back to boxes
        </Link>
      </div>
    );
  }
  return <BoxDetailLoaded box={box.data} />;
}

function BoxDetailLoaded({ box }: { box: BoxDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const locations = useLocations();
  const update = useUpdateBox(box.id);
  const toggle = useToggleBoxStatus(box.id);
  const remove = useDeleteBox();
  const upload = useUploadPhotos(box.id);
  const reorder = useReorderPhotos(box.id);
  const deletePhoto = useDeletePhoto(box.id);
  const analyzePhoto = useAnalyzePhoto(box.id);
  const analyzeBox = useAnalyzeBox(box.id);
  const createItem = useCreateItem(box.id);
  const updateItem = useUpdateItem(box.id);
  const deleteItem = useDeleteItem(box.id);
  const bulkDelete = useBulkDeleteItems(box.id);

  const aiAvailable = settings.data?.aiAvailable ?? false;
  const [params, setParams] = useSearchParams();
  // ?capture=1 is set right after a pre-printed label is scanned: open the guided capture panel.
  const [scanMode, setScanMode] = useState<'capture' | 'rescan' | null>(
    params.get('capture') === '1' ? (box.photos.length ? 'rescan' : 'capture') : null,
  );
  const closeScan = () => {
    setScanMode(null);
    if (params.has('capture')) {
      const next = new URLSearchParams(params);
      next.delete('capture');
      setParams(next, { replace: true });
    }
  };
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(box.name ?? '');
  const busy = update.isPending || toggle.isPending || reorder.isPending || deletePhoto.isPending;

  const saveName = () => {
    setEditingName(false);
    const next = nameDraft.trim() || null;
    if (next === (box.name ?? null)) return;
    update.mutate({ name: next }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const onErr = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <button
            className="btn-ghost -ml-2 px-2"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/boxes'))}
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <LabelChip label={box.labelId} size="lg" />
            <StatusPill status={box.status} />
          </span>
        }
        action={
          <div className="flex gap-2">
            {scanMode === null && (
              <button
                type="button"
                className={box.photos.length ? 'btn-secondary btn-sm' : 'btn-accent btn-sm'}
                onClick={() => setScanMode(box.photos.length ? 'rescan' : 'capture')}
                title={
                  box.photos.length
                    ? 'Retake photos and re-catalogue the contents'
                    : 'Photograph the contents'
                }
              >
                <CameraIcon className="h-4 w-4" /> {box.photos.length ? 'Rescan' : 'Scan'}
              </button>
            )}
            <Link to={`/labels?ids=${box.id}`} className="btn-secondary btn-sm" title="Print label">
              <PrintIcon className="h-4 w-4" /> Label
            </Link>
          </div>
        }
      />

      {scanMode && (
        <ScanPanel
          boxId={box.id}
          labelId={box.labelId}
          mode={scanMode}
          hasPhotos={box.photos.length > 0}
          aiAvailable={aiAvailable}
          onDone={closeScan}
          onCancel={closeScan}
        />
      )}

      {/* Name + location + status */}
      <div className="card space-y-3 p-4">
        {editingName ? (
          <input
            className="input text-lg font-semibold"
            value={nameDraft}
            autoFocus
            maxLength={200}
            placeholder="Box name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                setNameDraft(box.name ?? '');
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => setEditingName(true)}
          >
            <span className="text-lg font-semibold">
              {box.name || <span className="font-normal text-ink-mute">Tap to name this box</span>}
            </span>
            <span className="ml-2 text-xs text-ink-mute">edit</span>
          </button>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            className="input py-2"
            value={box.locationId ?? ''}
            onChange={(e) =>
              update.mutate(
                { locationId: e.target.value ? Number(e.target.value) : null },
                { onError: onErr },
              )
            }
            aria-label="Location"
          >
            <option value="">No location</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            className={box.status === 'sealed' ? 'btn-secondary' : 'btn-primary'}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(undefined, { onError: onErr })}
          >
            <LockIcon className="h-4 w-4" /> {box.status === 'sealed' ? 'Unseal' : 'Seal'}
          </button>
        </div>
      </div>

      {/* Photos */}
      <PhotoGallery
        photos={box.photos}
        aiAvailable={aiAvailable}
        busy={busy}
        onDelete={(pid) => deletePhoto.mutate(pid, { onError: onErr })}
        onReorder={(ids) => reorder.mutate(ids, { onError: onErr })}
        onAnalyze={(pid) =>
          analyzePhoto.mutate(pid, {
            onSuccess: () => toast.success('Re-analyzing photo…'),
            onError: onErr,
          })
        }
      />
      {scanMode === null && (
        <PhotoUploader
          uploading={upload.isPending}
          onUpload={(files) =>
            upload.mutateAsync(files).then((r) => {
              toast.success(
                r.aiQueued
                  ? `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} added — AI is analyzing`
                  : `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} added`,
              );
            })
          }
          compact={box.photos.length > 0}
        />
      )}

      {/* AI + description */}
      <DescriptionCard
        box={box}
        aiAvailable={aiAvailable}
        onSave={(text) => update.mutate({ aiDescription: text }, { onError: onErr })}
        onRerun={() =>
          analyzeBox.mutate(undefined, {
            onSuccess: () => toast.success('Analyzing all photos…'),
            onError: onErr,
          })
        }
        rerunning={analyzeBox.isPending}
      />

      {/* Items */}
      <ItemList
        items={box.items}
        busy={createItem.isPending || deleteItem.isPending || bulkDelete.isPending}
        onCreate={(input) => createItem.mutateAsync(input)}
        onUpdate={(itemId, input) => updateItem.mutateAsync({ id: itemId, ...input })}
        onDelete={(itemId) => deleteItem.mutateAsync(itemId).catch(onErr)}
        onDeleteAllAi={() => bulkDelete.mutateAsync('ai').catch(onErr)}
      />

      <div className="flex items-center justify-between px-1 pt-2 text-xs text-ink-mute">
        <span>
          Created {new Date(box.createdAt).toLocaleDateString()} · Updated{' '}
          {new Date(box.updatedAt).toLocaleString()}
          {box.printedAt
            ? ` · Label printed ${new Date(box.printedAt).toLocaleDateString()}`
            : ' · Label not printed'}
        </span>
        <button
          className="btn-danger btn-sm"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete box ${box.labelId} and all its photos and items? This cannot be undone.`,
              )
            ) {
              remove.mutate(box.id, {
                onSuccess: () => {
                  toast.success(`Deleted ${box.labelId}`);
                  navigate('/boxes', { replace: true });
                },
                onError: onErr,
              });
            }
          }}
        >
          Delete box
        </button>
      </div>
    </div>
  );
}

function DescriptionCard({
  box,
  aiAvailable,
  onSave,
  onRerun,
  rerunning,
}: {
  box: BoxDetail;
  aiAvailable: boolean;
  onSave: (text: string | null) => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const [draft, setDraft] = useState(box.aiDescription ?? '');
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Sync from server when not editing (e.g. AI finished).
  useEffect(() => {
    if (!dirty) setDraft(box.aiDescription ?? '');
  }, [box.aiDescription, dirty]);

  const change = (v: string) => {
    setDraft(v);
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onSave(v.trim() || null);
      setDirty(false);
    }, 900);
  };

  const pending = box.aiStatus === 'pending';
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Description <AiPill status={box.aiStatus} error={box.aiError} />
        </h2>
        {aiAvailable && box.photos.length > 0 && (
          <button
            className="btn-ghost btn-sm text-xs"
            disabled={pending || rerunning}
            onClick={() => {
              if (box.items.some((i) => i.source === 'ai')) {
                if (
                  !window.confirm(
                    'Re-analyze all photos together? This replaces the current AI-suggested items (manual items are kept).',
                  )
                )
                  return;
              }
              onRerun();
            }}
          >
            {pending || rerunning ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <SparkIcon className="h-4 w-4" />
            )}{' '}
            Re-run AI on all photos
          </button>
        )}
      </div>
      {box.aiStatus === 'error' && box.aiError && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-bad">
          AI failed: {box.aiError}
          {aiAvailable && ' — use the re-run button to try again.'}
        </p>
      )}
      {!aiAvailable && box.photos.length > 0 && box.aiStatus === 'none' && (
        <p className="mb-2 text-xs text-ink-mute">
          AI analysis is off (no API key configured). You can still describe the contents here.
        </p>
      )}
      <textarea
        className="input min-h-[96px] resize-y text-[15px] leading-relaxed"
        placeholder={
          pending
            ? 'AI is looking at the photos…'
            : 'What is in this box? (AI fills this in from photos; edit freely.)'
        }
        value={draft}
        onChange={(e) => change(e.target.value)}
        maxLength={20000}
      />
      <div className="mt-1 text-right text-[11px] text-ink-mute">{dirty ? 'Saving…' : 'Saved'}</div>
    </div>
  );
}
