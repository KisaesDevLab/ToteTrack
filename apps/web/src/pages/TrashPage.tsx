import { Link } from 'react-router-dom';
import {
  useDeleteBox,
  useEmptyTrash,
  usePurgePhoto,
  useRestoreBox,
  useRestorePhoto,
  useTrash,
} from '@/api/hooks';
import { ChevronLeft } from '@/components/AppShell';
import { EmptyState, ErrorNote, LabelChip, PageHeader, SkeletonList } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

function daysLeft(deletedAt: string, retentionDays: number): number {
  const expires = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  return Math.max(0, Math.ceil((expires - Date.now()) / 86_400_000));
}

/** Soft-deleted boxes and photos; restore or delete permanently. Auto-purged after 30 days. */
export function TrashPage() {
  const trash = useTrash();
  const restoreBox = useRestoreBox();
  const purgeBox = useDeleteBox();
  const restorePhoto = useRestorePhoto();
  const purgePhoto = usePurgePhoto();
  const empty = useEmptyTrash();
  const toast = useToast();
  const onErr = (e: unknown) => toast.error(errorMessage(e));

  const total = (trash.data?.boxes.length ?? 0) + (trash.data?.photos.length ?? 0);
  const retention = trash.data?.retentionDays ?? 30;

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link to="/settings" className="btn-ghost -ml-2 px-2" aria-label="Back to settings">
            <ChevronLeft />
          </Link>
        }
        title="Trash"
        subtitle={`Deleted boxes and photos stay here for ${retention} days, then vanish for good.`}
        action={
          total > 0 ? (
            <button
              className="btn-danger btn-sm"
              disabled={empty.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently delete everything in the Trash (${total} item${total === 1 ? '' : 's'})? This cannot be undone.`,
                  )
                )
                  empty.mutate(undefined, {
                    onSuccess: (r) =>
                      toast.success(
                        `Emptied: ${r.boxes} box${r.boxes === 1 ? '' : 'es'}, ${r.photos} photo${r.photos === 1 ? '' : 's'}`,
                      ),
                    onError: onErr,
                  });
              }}
            >
              Empty Trash
            </button>
          ) : undefined
        }
      />

      {trash.isPending ? (
        <SkeletonList rows={3} />
      ) : trash.isError ? (
        <ErrorNote message={errorMessage(trash.error)} retry={() => void trash.refetch()} />
      ) : total === 0 ? (
        <EmptyState title="Trash is empty" body="Deleted boxes and photos will show up here." />
      ) : (
        <>
          {trash.data.boxes.length > 0 && (
            <section className="card">
              <h2 className="px-4 pt-3 text-sm font-semibold">
                Boxes <span className="font-normal text-ink-mute">({trash.data.boxes.length})</span>
              </h2>
              <ul className="divide-y divide-line px-2 pt-1">
                {trash.data.boxes.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-2 py-2.5">
                    <Link to={`/boxes/${b.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      {b.thumbUrl ? (
                        <img
                          src={b.thumbUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-paper-sunk" />
                      )}
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="shrink-0 whitespace-nowrap">
                            <LabelChip label={b.labelId} size="sm" />
                          </span>
                          <span className="truncate text-sm font-medium">
                            {b.name || <span className="font-normal text-ink-mute">unnamed</span>}
                          </span>
                        </span>
                        <span className="block text-xs text-ink-mute">
                          {b.photoCount} photo{b.photoCount === 1 ? '' : 's'} · {b.itemCount} item
                          {b.itemCount === 1 ? '' : 's'} · {daysLeft(b.deletedAt!, retention)} day
                          {daysLeft(b.deletedAt!, retention) === 1 ? '' : 's'} left
                        </span>
                      </span>
                    </Link>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={restoreBox.isPending}
                      onClick={() =>
                        restoreBox.mutate(b.id, {
                          onSuccess: () => toast.success(`Restored ${b.labelId}`),
                          onError: onErr,
                        })
                      }
                    >
                      Restore
                    </button>
                    <button
                      className="btn-ghost btn-sm text-bad"
                      disabled={purgeBox.isPending}
                      aria-label={`Delete ${b.labelId} permanently`}
                      onClick={() => {
                        if (
                          window.confirm(`Permanently delete ${b.labelId}? This cannot be undone.`)
                        )
                          purgeBox.mutate({ id: b.id, permanent: true }, { onError: onErr });
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {trash.data.photos.length > 0 && (
            <section className="card">
              <h2 className="px-4 pt-3 text-sm font-semibold">
                Photos{' '}
                <span className="font-normal text-ink-mute">({trash.data.photos.length})</span>
              </h2>
              <ul className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4">
                {trash.data.photos.map((p) => (
                  <li key={p.id} className="space-y-1">
                    <a href={p.originalUrl} target="_blank" rel="noreferrer">
                      <img
                        src={p.thumbUrl}
                        alt={`Deleted photo from ${p.boxLabelId}`}
                        className="aspect-square w-full rounded-lg object-cover"
                        loading="lazy"
                      />
                    </a>
                    <div className="flex items-center justify-between text-[11px] text-ink-mute">
                      <Link to={`/boxes/${p.boxId}`}>
                        <LabelChip label={p.boxLabelId} size="sm" />
                      </Link>
                      <span>{daysLeft(p.deletedAt!, retention)}d</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary btn-sm flex-1"
                        disabled={restorePhoto.isPending}
                        onClick={() =>
                          restorePhoto.mutate(p.id, {
                            onSuccess: () => toast.success(`Photo restored to ${p.boxLabelId}`),
                            onError: onErr,
                          })
                        }
                      >
                        Restore
                      </button>
                      <button
                        className="btn-ghost btn-sm text-bad"
                        disabled={purgePhoto.isPending}
                        aria-label="Delete photo permanently"
                        onClick={() => {
                          if (window.confirm('Permanently delete this photo?'))
                            purgePhoto.mutate(p.id, { onError: onErr });
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
