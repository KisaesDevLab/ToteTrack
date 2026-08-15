import type { BoxSummary } from '@totetrack/shared';
import { Link } from 'react-router-dom';
import type { ViewMode } from '@/lib/viewMode';
import { AiPill, BoxIcon, LabelChip, LockIcon } from './ui';

export function BoxCard({
  box,
  hint,
  headline,
  selectable,
  selected,
  onToggleSelect,
  variant = 'list',
}: {
  box: BoxSummary;
  hint?: string;
  headline?: string | null;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** `list`: thumbnail on the left. `cards`: full-width photo with details underneath. */
  variant?: ViewMode;
}) {
  const meta = [
    box.itemCount ? `${box.itemCount} item${box.itemCount === 1 ? '' : 's'}` : 'No items',
    box.photoCount ? `${box.photoCount} photo${box.photoCount === 1 ? '' : 's'}` : null,
    hint,
  ]
    .filter(Boolean)
    .join(' · ');

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      <LabelChip label={box.labelId} />
      {box.locationName && (
        <span className="truncate rounded-md bg-paper-sunk px-1.5 py-0.5 text-xs text-ink-soft">
          {box.locationName}
        </span>
      )}
      <AiPill status={box.aiStatus} error={box.aiError} />
    </div>
  );

  const description = headline ? (
    <div
      className="mt-0.5 line-clamp-2 text-xs text-ink-mute [&_b]:font-semibold [&_b]:text-ink"
      dangerouslySetInnerHTML={{ __html: headline }}
    />
  ) : (
    <div className="mt-0.5 truncate text-xs text-ink-mute">{meta}</div>
  );

  if (variant === 'cards' && !selectable) {
    return (
      <Link
        to={`/boxes/${box.id}`}
        className="card block overflow-hidden transition hover:bg-paper-sunk/60 active:bg-paper-sunk"
      >
        <div className={`relative w-full bg-paper-sunk ${box.thumbUrl ? 'aspect-[4/3]' : 'h-24'}`}>
          {box.thumbUrl ? (
            <img
              src={box.thumbUrl}
              alt={box.name ? `Photo of ${box.name}` : `Photo of box ${box.labelId}`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center gap-2 text-ink-mute">
              <BoxIcon className="h-6 w-6" />
              <span className="text-xs">No photo yet</span>
            </div>
          )}
          <div className="absolute left-2 top-2 flex items-center gap-2">
            <LabelChip label={box.labelId} size="lg" />
          </div>
          {box.status === 'sealed' && (
            <span
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-paper"
              title="Sealed"
            >
              <LockIcon className="h-3 w-3" /> Sealed
            </span>
          )}
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-base font-semibold">
              {box.name || <span className="font-normal text-ink-mute">Untitled box</span>}
            </div>
            <AiPill status={box.aiStatus} error={box.aiError} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-mute">
            {box.locationName && (
              <span className="rounded-md bg-paper-sunk px-1.5 py-0.5 text-ink-soft">
                {box.locationName}
              </span>
            )}
            <span>{meta}</span>
          </div>
          {headline && (
            <div
              className="mt-1.5 line-clamp-2 text-xs text-ink-mute [&_b]:font-semibold [&_b]:text-ink"
              dangerouslySetInnerHTML={{ __html: headline }}
            />
          )}
        </div>
      </Link>
    );
  }

  const inner = (
    <>
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-paper-sunk">
        {box.thumbUrl ? (
          <img src={box.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink-mute">
            <BoxIcon className="h-6 w-6" />
          </div>
        )}
        {box.status === 'sealed' && (
          <span
            className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-paper"
            title="Sealed"
          >
            <LockIcon className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {chips}
        <div className="mt-1 truncate text-[15px] font-semibold">
          {box.name || <span className="font-normal text-ink-mute">Untitled box</span>}
        </div>
        {description}
      </div>
    </>
  );

  if (selectable) {
    return (
      <label
        className={`card flex cursor-pointer items-center gap-3 p-3 ${selected ? 'ring-2 ring-accent' : ''}`}
      >
        <input
          type="checkbox"
          className="h-5 w-5 accent-accent"
          checked={Boolean(selected)}
          onChange={onToggleSelect}
        />
        {inner}
      </label>
    );
  }
  return (
    <Link
      to={`/boxes/${box.id}`}
      className="card flex items-center gap-3 p-3 transition hover:bg-paper-sunk/60 active:bg-paper-sunk"
    >
      {inner}
    </Link>
  );
}

/** Segmented list/cards switch shown above box lists. */
export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const btn = (m: ViewMode, label: string, icon: JSX.Element) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={mode === m}
      aria-label={`${label} view`}
      title={`${label} view`}
      className={`grid h-9 w-9 place-items-center rounded-lg ${
        mode === m ? 'bg-paper-raised text-ink shadow-card' : 'text-ink-mute'
      }`}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex gap-0.5 rounded-xl bg-paper-sunk p-0.5" role="group" aria-label="Layout">
      {btn(
        'list',
        'List',
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>,
      )}
      {btn(
        'cards',
        'Photo cards',
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="16" height="7" rx="1.5" />
          <rect x="4" y="14" width="16" height="6" rx="1.5" />
        </svg>,
      )}
    </div>
  );
}
