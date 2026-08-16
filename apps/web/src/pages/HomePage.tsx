import { normalizeLabelId } from '@totetrack/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteSearch, useLocations } from '@/api/hooks';
import { SearchIcon } from '@/components/AppShell';
import { BoxCard, ViewModeToggle } from '@/components/BoxCard';
import { EmptyState, ErrorNote, SkeletonList, Spinner } from '@/components/ui';
import { useViewMode } from '@/lib/viewMode';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const locationId = params.get('loc') ? Number(params.get('loc')) : undefined;
  const status = params.get('status') ?? undefined;
  const debounced = useDebounced(q.trim(), 250);
  const navigate = useNavigate();
  const locations = useLocations();
  const search = useInfiniteSearch(debounced, { locationId, status });
  const [viewMode, setViewMode] = useViewMode();

  // Infinite scroll: fetch the next 50 when the sentinel comes into view.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !search.hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !search.isFetchingNextPage) void search.fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [search, search.hasNextPage, search.isFetchingNextPage]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const setFilter = (key: 'loc' | 'status', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const exactLabel = useMemo(() => normalizeLabelId(debounced), [debounced]);
  const results = useMemo(() => search.data?.pages.flat() ?? [], [search.data]);
  const isSearching = debounced.length > 0;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (exactLabel && results[0]?.labelId === exactLabel) navigate(`/boxes/${results[0].id}`);
        }}
        role="search"
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-mute" />
          <input
            className="input pl-11 pr-10 text-[17px] shadow-card"
            placeholder="Search items, boxes, labels…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search"
          />
          {q && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-xs text-ink-mute"
              onClick={() => setQ('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <select
          className="input w-auto min-w-[9rem] py-2 text-sm"
          value={locationId ?? ''}
          onChange={(e) => setFilter('loc', e.target.value)}
          aria-label="Filter by location"
        >
          <option value="">All locations</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto min-w-[8rem] py-2 text-sm"
          value={status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="sealed">Sealed</option>
        </select>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-soft">
            {isSearching
              ? `Results${search.data ? ` (${results.length}${search.hasNextPage ? '+' : ''})` : ''}`
              : 'Recently updated'}
          </h2>
          <div className="flex items-center gap-3">
            {!isSearching && (
              <Link to="/boxes" className="text-xs font-medium text-accent-deep">
                All boxes →
              </Link>
            )}
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        {search.isPending ? (
          <SkeletonList />
        ) : search.isError ? (
          <ErrorNote message="Search failed" retry={() => void search.refetch()} />
        ) : results.length === 0 ? (
          isSearching ? (
            <EmptyState
              title={`Nothing matches “${debounced}”`}
              body={
                exactLabel
                  ? `No box is labelled ${exactLabel}.`
                  : 'Try a different word, a location, or part of a label like “A-1”.'
              }
              action={
                exactLabel ? (
                  <Link
                    to={`/boxes/new?label=${encodeURIComponent(exactLabel)}`}
                    className="btn-primary"
                  >
                    Create {exactLabel}
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="No boxes yet"
              body="Add your first tote, then print a label and stick it on."
              action={
                <Link to="/boxes/new" className="btn-primary">
                  Add a box
                </Link>
              }
            />
          )
        ) : (
          <ul
            className={`${viewMode === 'cards' ? 'space-y-3' : 'space-y-2'} ${search.isFetching && search.isPlaceholderData ? 'opacity-70' : ''}`}
          >
            {results.map((r) => (
              <li key={r.id}>
                <BoxCard
                  box={r}
                  variant={viewMode}
                  headline={r.headline}
                  hint={
                    isSearching && r.matchedFields.length
                      ? `matched ${r.matchedFields.join(', ')}`
                      : undefined
                  }
                />
              </li>
            ))}
            <li ref={sentinel} className="flex justify-center py-3 text-xs text-ink-mute">
              {search.isFetchingNextPage ? (
                <Spinner className="h-4 w-4" />
              ) : search.hasNextPage ? (
                <button className="underline" onClick={() => void search.fetchNextPage()}>
                  Load more
                </button>
              ) : null}
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
