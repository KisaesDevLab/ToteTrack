import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBoxes, useLocations, useSeries } from '@/api/hooks';
import { BoxCard, ViewModeToggle } from '@/components/BoxCard';
import { EmptyState, ErrorNote, PageHeader, SkeletonList } from '@/components/ui';
import { useViewMode } from '@/lib/viewMode';

export function BoxesPage() {
  const [params, setParams] = useSearchParams();
  const locationId = params.get('loc') ? Number(params.get('loc')) : undefined;
  const seriesId = params.get('series') ? Number(params.get('series')) : undefined;
  const status = (params.get('status') as 'open' | 'sealed' | null) ?? undefined;
  const sort = (params.get('sort') as 'label' | 'recent' | 'name' | null) ?? 'label';

  const query = useMemo(
    () => ({ locationId, seriesId, status, sort }),
    [locationId, seriesId, status, sort],
  );
  const boxes = useBoxes(query);
  const locations = useLocations();
  const series = useSeries();
  const [viewMode, setViewMode] = useViewMode();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Boxes"
        subtitle={
          boxes.data ? `${boxes.data.length} box${boxes.data.length === 1 ? '' : 'es'}` : undefined
        }
        action={
          <div className="flex items-center gap-2">
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            <Link to="/boxes/new" className="btn-primary btn-sm">
              + New box
            </Link>
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

      {boxes.isPending ? (
        <SkeletonList rows={6} />
      ) : boxes.isError ? (
        <ErrorNote message="Could not load boxes" retry={() => void boxes.refetch()} />
      ) : boxes.data.length === 0 ? (
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
        <ul className={viewMode === 'cards' ? 'space-y-3' : 'space-y-2'}>
          {boxes.data.map((b) => (
            <li key={b.id}>
              <BoxCard box={b} variant={viewMode} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
