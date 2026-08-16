import { useState } from 'react';
import { useDeletePreprinted, usePreprint, usePreprinted, useSeries } from '@/api/hooks';
import { LabelChip, Spinner } from './ui';
import { TrashIcon } from './AppShell';
import { errorMessage, useToast } from '@/lib/toast';

/** "Print labels first, fill boxes later": reserve the next N numbers of a series and print blank labels. */
export function PreprintCard({ templateId, perSheet }: { templateId: string; perSheet: number }) {
  const series = useSeries();
  const preprinted = usePreprinted(true);
  const preprint = usePreprint();
  const voidLabel = useDeletePreprinted();
  const toast = useToast();
  const [seriesId, setSeriesId] = useState<number | ''>('');
  const [count, setCount] = useState(perSheet);
  const [startOffset, setStartOffset] = useState(0);
  const [showList, setShowList] = useState(false);

  const list = series.data ?? [];
  const selectedId = seriesId === '' ? (list[0]?.id ?? '') : seriesId;
  const selected = list.find((s) => s.id === selectedId);
  const unclaimed = preprinted.data ?? [];
  const from = selected ? selected.nextNumber : null;
  const preview =
    selected && from
      ? `${selected.letter}-${String(from).padStart(3, '0')} … ${selected.letter}-${String(from + count - 1).padStart(3, '0')}`
      : '';

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Pre-print blank labels</h2>
        <p className="text-xs text-ink-mute">
          Print a batch of labels now and stick them on totes as you pack. Scanning a pre-printed
          label creates the box and opens the camera so you can record what went in.
        </p>
      </div>
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <select
          className="input"
          value={selectedId}
          onChange={(e) => setSeriesId(Number(e.target.value))}
          aria-label="Series"
          disabled={!list.length}
        >
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              Series {s.letter}
              {s.description ? ` — ${s.description}` : ''} (next {s.letter}-
              {String(s.nextNumber).padStart(3, '0')})
            </option>
          ))}
        </select>
        <input
          className="input text-center"
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          value={count}
          onChange={(e) =>
            setCount(Math.min(200, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))
          }
          aria-label="How many labels"
        />
      </div>
      {perSheet > 1 && (
        <label className="flex items-center gap-2 text-xs text-ink-mute">
          Start at position
          <input
            className="input w-20 py-1.5 text-center"
            type="number"
            min={1}
            max={perSheet}
            value={startOffset + 1}
            onChange={(e) =>
              setStartOffset(
                Math.min(perSheet - 1, Math.max(0, (Number.parseInt(e.target.value, 10) || 1) - 1)),
              )
            }
          />
          on the first sheet
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-mute">
          {preview ? (
            <>
              Will print <span className="font-mono text-ink">{preview}</span>
            </>
          ) : (
            'Create a series first'
          )}
        </span>
        <button
          className="btn-primary"
          disabled={!selected || preprint.isPending}
          onClick={() =>
            preprint.mutate(
              { seriesId: selected!.id, count, templateId, startOffset },
              {
                onSuccess: () =>
                  toast.success(
                    `${count} blank label${count === 1 ? '' : 's'} reserved and downloaded`,
                  ),
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }
        >
          {preprint.isPending ? <Spinner className="h-4 w-4" /> : null} Print {count} blank label
          {count === 1 ? '' : 's'}
        </button>
      </div>
      {unclaimed.length > 0 && (
        <div className="border-t border-line pt-3">
          <button
            className="text-xs font-medium text-accent-deep"
            onClick={() => setShowList((v) => !v)}
          >
            {unclaimed.length} pre-printed label{unclaimed.length === 1 ? '' : 's'} not yet on a box{' '}
            {showList ? '▴' : '▾'}
          </button>
          {showList && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {unclaimed.map((l) => (
                <li
                  key={l.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-paper-sunk px-1.5 py-1"
                >
                  <LabelChip label={l.labelId} size="sm" />
                  <button
                    className="text-ink-mute hover:text-bad"
                    title="Void this label (misprint / lost)"
                    aria-label={`Void ${l.labelId}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Void ${l.labelId}? Scanning it will no longer auto-create a box.`,
                        )
                      )
                        voidLabel.mutate(l.id, {
                          onError: (err) => toast.error(errorMessage(err)),
                        });
                    }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
