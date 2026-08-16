import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBoxes, useDownloadLabels, useLabelTemplates, useSettings } from '@/api/hooks';
import { BoxCard } from '@/components/BoxCard';
import { PreprintCard } from '@/components/PreprintCard';
import { ErrorNote, Field, PageHeader, SkeletonList, Spinner } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

export function LabelsPage() {
  const [params] = useSearchParams();
  const preselected = useMemo(
    () =>
      (params.get('ids') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0),
    [params],
  );
  const boxes = useBoxes({ sort: 'label' });
  const templates = useLabelTemplates();
  const settings = useSettings();
  const download = useDownloadLabels();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<number>>(new Set(preselected));
  const [templateId, setTemplateId] = useState<string>('');
  const [startOffset, setStartOffset] = useState(0);
  const [includeName, setIncludeName] = useState(true);
  const [markPrinted, setMarkPrinted] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unprinted'>(
    preselected.length ? 'all' : 'unprinted',
  );

  useEffect(() => {
    if (!templateId && settings.data) setTemplateId(settings.data.defaultLabelTemplate);
  }, [settings.data, templateId]);

  const template =
    templates.data?.templates.find((t) => t.id === templateId) ?? templates.data?.templates[0];
  const list = (boxes.data ?? []).filter((b) => filter === 'all' || !b.printedAt);
  const selectedList = (boxes.data ?? []).filter((b) => selected.has(b.id));

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const generate = () => {
    if (!selected.size) return;
    // Print in label order.
    const boxIds = selectedList.map((b) => b.id);
    download.mutate(
      {
        boxIds,
        templateId: templateId || undefined,
        startOffset: effectiveOffset,
        includeName,
        markPrinted,
      },
      {
        onSuccess: () => {
          toast.success(
            `PDF with ${boxIds.length} label${boxIds.length === 1 ? '' : 's'} downloaded`,
          );
          if (markPrinted && filter === 'unprinted') setSelected(new Set());
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const perSheet = template?.perSheet ?? 10;
  const effectiveOffset = perSheet > 1 ? startOffset : 0;
  const sheets = selected.size ? Math.ceil((selected.size + effectiveOffset) / perSheet) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Print labels"
        subtitle="Select boxes, pick your Avery sheet, download a PDF and print at 100% scale."
      />

      <div className="card space-y-3 p-4">
        <Field label="Label sheet">
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {(templates.data?.templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {template && <p className="-mt-1 text-xs text-ink-mute">{template.description}</p>}
        <div className="grid grid-cols-2 gap-3">
          {perSheet > 1 ? (
            <Field
              label="Start at position"
              hint={`1–${perSheet}; skip labels already used on a partial sheet`}
            >
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={perSheet}
                value={startOffset + 1}
                onChange={(e) =>
                  setStartOffset(
                    Math.min(
                      perSheet - 1,
                      Math.max(0, (Number.parseInt(e.target.value, 10) || 1) - 1),
                    ),
                  )
                }
              />
            </Field>
          ) : (
            <p className="text-xs text-ink-mute">
              One label per page — set your printer's paper size to the label size and print at 100%
              with no margins.
            </p>
          )}
          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={includeName}
                onChange={(e) => setIncludeName(e.target.checked)}
              />{' '}
              Print box name
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={markPrinted}
                onChange={(e) => setMarkPrinted(e.target.checked)}
              />{' '}
              Mark as printed
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-sm text-ink-mute">
            {selected.size} selected · {sheets}{' '}
            {perSheet > 1
              ? sheets === 1
                ? 'sheet'
                : 'sheets'
              : sheets === 1
                ? 'label page'
                : 'label pages'}
          </span>
          <div className="flex gap-2">
            <a
              className="btn-secondary btn-sm"
              href={`/api/labels/calibration?templateId=${encodeURIComponent(templateId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Calibration page
            </a>
            <button
              className="btn-primary"
              disabled={!selected.size || download.isPending}
              onClick={generate}
            >
              {download.isPending ? <Spinner className="h-4 w-4" /> : null} Download PDF
            </button>
          </div>
        </div>
      </div>

      <PreprintCard templateId={templateId} perSheet={perSheet} />

      <h2 className="pt-2 text-sm font-semibold text-ink-soft">Print labels for existing boxes</h2>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-paper-sunk p-1 text-sm">
          <button
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${filter === 'unprinted' ? 'bg-paper-raised shadow-card font-semibold' : 'text-ink-mute'}`}
            onClick={() => setFilter('unprinted')}
          >
            Unprinted
          </button>
          <button
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${filter === 'all' ? 'bg-paper-raised shadow-card font-semibold' : 'text-ink-mute'}`}
            onClick={() => setFilter('all')}
          >
            All boxes
          </button>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            className="btn-ghost btn-sm"
            onClick={() => setSelected(new Set(list.map((b) => b.id)))}
            disabled={!list.length}
          >
            Select {filter === 'unprinted' ? 'all unprinted' : 'all'}
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setSelected(new Set())}
            disabled={!selected.size}
          >
            Clear
          </button>
        </div>
      </div>

      {boxes.isPending ? (
        <SkeletonList />
      ) : boxes.isError ? (
        <ErrorNote message="Could not load boxes" retry={() => void boxes.refetch()} />
      ) : list.length === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-mute">
          {filter === 'unprinted' ? 'Every box already has a printed label.' : 'No boxes yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => (
            <li key={b.id}>
              <BoxCard
                box={b}
                selectable
                selected={selected.has(b.id)}
                onToggleSelect={() => toggle(b.id)}
                hint={
                  b.printedAt
                    ? `printed ${new Date(b.printedAt).toLocaleDateString()}`
                    : 'not printed'
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
