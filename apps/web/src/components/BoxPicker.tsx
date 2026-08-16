import type { BoxSummary } from '@totetrack/shared';
import { useEffect, useState } from 'react';
import { useSearch } from '@/api/hooks';
import { LabelChip, Spinner, StatusPill } from './ui';

/**
 * Bottom-sheet picker: search boxes by label / name / location and choose one.
 * Used for "move item to another box".
 */
export function BoxPicker({
  title,
  excludeId,
  onPick,
  onClose,
  busy,
}: {
  title: string;
  excludeId?: number;
  onPick: (box: BoxSummary) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const results = useSearch(debounced);
  const list = (results.data ?? []).filter((b) => b.id !== excludeId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-paper shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="px-4 py-2">
          <input
            className="input"
            placeholder="Search by label, name or location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            enterKeyHint="search"
          />
        </div>
        <ul className="min-h-[200px] flex-1 divide-y divide-line overflow-y-auto px-2 pb-3">
          {results.isPending && (
            <li className="flex justify-center py-6">
              <Spinner />
            </li>
          )}
          {!results.isPending && list.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-ink-mute">No matching boxes.</li>
          )}
          {list.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-paper-sunk disabled:opacity-50"
                disabled={busy}
                onClick={() => onPick(b)}
              >
                <LabelChip label={b.labelId} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {b.name || <span className="font-normal text-ink-mute">unnamed</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-mute">
                    {b.locationName ?? 'no location'} · {b.itemCount} item
                    {b.itemCount === 1 ? '' : 's'}
                  </span>
                </span>
                <StatusPill status={b.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
