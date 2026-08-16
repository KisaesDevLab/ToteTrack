import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useBulkBoxes, useInfiniteBoxes, useLocations, useSeries } from '@/api/hooks';
import { BoxCard, ViewModeToggle } from '@/components/BoxCard';
import { EmptyState, ErrorNote, PageHeader, SkeletonList, Spinner } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';
import { useViewMode } from '@/lib/viewMode';

export function BoxesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const locationId = params.get('loc') ? Number(params.get('loc')) : undefined;
  const seriesId = params.get('series') ? Number(params.get('series')) : undefined;
  const status = (params.get('status') as 'open' | 'sealed' | null) ?? undefined;
  const sort = (params.get('sort') as 'label' | 'recent' | 'name' | null) ?? 'label';

  const query = useMemo(
    () => ({ locationId, seriesId, status, sort }),
    [locationId, seriesId, status, sort],
  );
  const boxes = useInfiniteBoxes(query);
  const locations = useLocations();
  const series = useSeries();
  const bulk = useBulkBoxes();
  const [viewMode, setViewMode] = useViewMode();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const all = useMemo(() => boxes.data?.pages.flat() ?? [], [boxes.data]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !boxes.hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !boxes.isFetchingNextPage) void boxes.fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [boxes, boxes.hasNextPage, boxes.isFetchingNextPage]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const ids = [...selected];
  const run = (body: Parameters<typeof bulk.mutate>[0], done: (n: number) => string) =>
    bulk.mutate(body, {
      onSuccess: (r) => {
        toast.success(done(r.updated));
        exitSelect();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <div className={selecting ? 'pb-24' : ''}>
      <PageHeader
        title="Boxes"
        subtitle={
          boxes.data
            ? `${all.length}${boxes.hasNextPage ? '+' : ''} box${all.length === 1 ? '' : 'es'}`
            : undefined
        }
        action={
          <div className="flex items-center gap-2">
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            {selecting ? (
              <button className="btn-secondary btn-sm" onClick={exitSelect}>
                Done
              </button>
            ) : (
              <>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setSelecting(true)}
                  disabled={all.length === 0}
                  title="Select several boxes to move, seal or print together"
                >
                  Select
                </button>
                <Link to="/boxes/new" className="btn-primary btn-sm">
                  + New box
                </Link>
              </>
            )}
          </div>
        }
      />
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <select
          className="input w-auto py-2 text-sm"
          value={sort}
          onChange={(e) => set('sort', e.target.value)}
          aria-label="Sort"
        >
          <option value="label">By label</option>
          <option value="recent">Recently updated</option>
          <option value="name">By name</option>
        </select>
        <select
          className="input w-auto py-2 text-sm"
          value={seriesId ?? ''}
          onChange={(e) => set('series', e.target.value)}
          aria-label="Series"
        >
          <option value="">All series</option>
          {(series.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              Series {s.letter}
              {s.description ? ` — ${s.description}` : ''}
            </option>
          ))}
        </select>
        <select
          className="input w-auto py-2 text-sm"
          value={locationId ?? ''}
          onChange={(e) => set('loc', e.target.value)}
          aria-label="Location"
        >
          <option value="">All locations</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto py-2 text-sm"
          value={status ?? ''}
          onChange={(e) => set('status', e.target.value)}
          aria-label="Status"
        >
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="sealed">Sealed</option>
        </select>
      </div>

      {selecting && (
        <div className="mb-3 flex items-center justify-between text-xs text-ink-mute">
          <span>
            {selected.size} selected
            {selected.size > 0 && (
              <>
                {' · '}
                <button className="underline" onClick={() => setSelected(new Set())}>
                  clear
                </button>
              </>
            )}
          </span>
          <button className="underline" onClick={() => setSelected(new Set(all.map((b) => b.id)))}>
            Select all loaded ({all.length})
          </button>
        </div>
      )}

      {boxes.isPending ? (
        <SkeletonList rows={6} />
      ) : boxes.isError ? (
        <ErrorNote message="Could not load boxes" retry={() => void boxes.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          title="No boxes match"
          body={
            locationId || seriesId || status
              ? 'Try clearing a filter.'
              : 'Create your first box to get started.'
          }
          action={
            <Link to="/boxes/new" className="btn-primary">
              Add a box
            </Link>
          }
        />
      ) : (
        <>
          <ul className={viewMode === 'cards' ? 'space-y-3' : 'space-y-2'}>
            {all.map((b) => (
              <li key={b.id}>
                <BoxCard
                  box={b}
                  variant={viewMode}
                  selectable={selecting}
                  selected={selected.has(b.id)}
                  onToggleSelect={() => toggle(b.id)}
                />
              </li>
            ))}
          </ul>
          <div ref={sentinel} className="flex justify-center py-4 text-xs text-ink-mute">
            {boxes.isFetchingNextPage ? (
              <Spinner className="h-4 w-4" />
            ) : boxes.hasNextPage ? (
              <button className="underline" onClick={() => void boxes.fetchNextPage()}>
                Load more
              </button>
            ) : all.length > 50 ? (
              'That’s all of them.'
            ) : null}
          </div>
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-2xl px-3 sm:bottom-4">
          <div className="card flex flex-wrap items-center gap-2 p-2 shadow-lg">
            <select
              className="input w-auto py-2 text-sm"
              value=""
              disabled={!ids.length || bulk.isPending}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                run(
                  {
                    ids,
                    action: 'setLocation',
                    locationId: v === 'none' ? null : Number(v),
                  },
                  (n) => `Moved ${n} box${n === 1 ? '' : 'es'}`,
                );
              }}
              aria-label="Set location"
            >
              <option value="">Set location…</option>
              <option value="none">No location</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary btn-sm"
              disabled={!ids.length || bulk.isPending}
              onClick={() => run({ ids, action: 'seal' }, (n) => `Sealed ${n}`)}
            >
              Seal
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={!ids.length || bulk.isPending}
              onClick={() => run({ ids, action: 'open' }, (n) => `Unsealed ${n}`)}
            >
              Unseal
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={!ids.length}
              onClick={() => navigate(`/labels?ids=${ids.join(',')}`)}
            >
              Print labels
            </button>
            <button
              className="btn-danger btn-sm ml-auto"
              disabled={!ids.length || bulk.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Move ${ids.length} box${ids.length === 1 ? '' : 'es'} to the Trash? You can restore them within 30 days.`,
                  )
                )
                  run({ ids, action: 'trash' }, (n) => `${n} moved to Trash`);
              }}
            >
              Trash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
