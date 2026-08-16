import type { Location } from '@totetrack/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useCreateLocation,
  useDeleteLocation,
  useLocations,
  useReorderLocations,
  useUpdateLocation,
} from '@/api/hooks';
import { ChevronLeft, PinIcon, TrashIcon } from '@/components/AppShell';
import { EmptyState, ErrorNote, PageHeader, SkeletonList } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

export function LocationsPage() {
  const locations = useLocations();
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const remove = useDeleteLocation();
  const reorder = useReorderLocations();
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim() },
      { onSuccess: () => setName(''), onError: (err) => toast.error(errorMessage(err)) },
    );
  };

  const move = (list: Location[], index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= list.length) return;
    const ids = list.map((l) => l.id);
    const [m] = ids.splice(index, 1);
    ids.splice(to, 0, m!);
    reorder.mutate(ids, { onError: (err) => toast.error(errorMessage(err)) });
  };

  const list = locations.data ?? [];

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Where boxes live. Labels never change when a box moves."
      />
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="New location, e.g. “Garage shelf 2”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <button className="btn-primary" disabled={create.isPending || !name.trim()}>
          Add
        </button>
      </form>

      {locations.isPending ? (
        <SkeletonList rows={3} />
      ) : locations.isError ? (
        <ErrorNote message="Could not load locations" retry={() => void locations.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<PinIcon className="mb-3 h-10 w-10 text-ink-mute" />}
          title="No locations yet"
          body="Add shelves, rooms, or closets so boxes can be assigned to them."
        />
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2.5">
              {editing?.id === l.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate(
                      { id: l.id, name: editing.name.trim() },
                      {
                        onSuccess: () => setEditing(null),
                        onError: (err) => toast.error(errorMessage(err)),
                      },
                    );
                  }}
                >
                  <input
                    className="input flex-1 py-2"
                    value={editing.name}
                    autoFocus
                    onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                    maxLength={100}
                  />
                  <button className="btn-primary btn-sm" disabled={!editing.name.trim()}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block w-full truncate text-left font-medium"
                      onClick={() => setEditing({ id: l.id, name: l.name })}
                      title="Rename"
                    >
                      {l.name}
                    </button>
                    <Link
                      to={`/boxes?loc=${l.id}`}
                      className="text-xs text-ink-mute underline-offset-2 hover:underline"
                    >
                      {l.boxCount ?? 0} box{l.boxCount === 1 ? '' : 'es'}
                    </Link>
                  </div>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => move(list, i, -1)}
                    aria-label="Move up"
                  >
                    <ChevronLeft className="h-4 w-4 rotate-90" />
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={i === list.length - 1 || reorder.isPending}
                    onClick={() => move(list, i, 1)}
                    aria-label="Move down"
                  >
                    <ChevronLeft className="h-4 w-4 -rotate-90" />
                  </button>
                  <button
                    className="btn-ghost btn-sm text-ink-mute hover:text-bad"
                    aria-label={`Delete ${l.name}`}
                    onClick={() => {
                      const n = l.boxCount ?? 0;
                      if (
                        window.confirm(
                          n
                            ? `Delete “${l.name}”? ${n} box${n === 1 ? '' : 'es'} will be left without a location.`
                            : `Delete “${l.name}”?`,
                        )
                      )
                        remove.mutate(l.id, { onError: (err) => toast.error(errorMessage(err)) });
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
