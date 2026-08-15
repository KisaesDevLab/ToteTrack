import { normalizeLabelId, LABEL_ID_REGEX } from '@totetrack/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateBox, useCreateSeries, useLocations, useSeries } from '@/api/hooks';
import { Field, LabelChip, PageHeader, Spinner } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

export function BoxNewPage() {
  const [params] = useSearchParams();
  const wanted = useMemo(() => normalizeLabelId(params.get('label') ?? ''), [params]);
  const wantedLetter = wanted ? LABEL_ID_REGEX.exec(wanted)?.[1]?.toUpperCase() : undefined;
  const wantedNumber = wanted
    ? Number.parseInt(LABEL_ID_REGEX.exec(wanted)?.[2] ?? '', 10)
    : undefined;

  const series = useSeries();
  const locations = useLocations();
  const createBox = useCreateBox();
  const createSeries = useCreateSeries();
  const navigate = useNavigate();
  const toast = useToast();

  const [seriesId, setSeriesId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState<number | ''>(
    params.get('loc') ? Number(params.get('loc')) : '',
  );
  const [useExactNumber, setUseExactNumber] = useState(Boolean(wantedNumber));
  const [newLetter, setNewLetter] = useState(wantedLetter ?? '');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    if (!series.data || seriesId !== '') return;
    const match = wantedLetter ? series.data.find((s) => s.letter === wantedLetter) : undefined;
    const first = match ?? series.data[0];
    if (first) setSeriesId(first.id);
  }, [series.data, seriesId, wantedLetter]);

  const selected = series.data?.find((s) => s.id === seriesId);
  const previewLabel = selected
    ? `${selected.letter}-${String(useExactNumber && wantedNumber && selected.letter === wantedLetter ? wantedNumber : selected.nextNumber).padStart(3, '0')}`
    : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (seriesId === '') return;
    createBox.mutate(
      {
        seriesId,
        name: name.trim() || null,
        locationId: locationId === '' ? null : locationId,
        number:
          useExactNumber && wantedNumber && selected?.letter === wantedLetter
            ? wantedNumber
            : undefined,
      },
      {
        onSuccess: (box) => {
          toast.success(`Created ${box.labelId}`);
          navigate(`/boxes/${box.id}`, { replace: true });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const addSeries = (e: FormEvent) => {
    e.preventDefault();
    createSeries.mutate(
      { letter: newLetter, description: newDesc.trim() || null },
      {
        onSuccess: (s) => {
          setSeriesId(s.id);
          setNewLetter('');
          setNewDesc('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const noSeries = series.data && series.data.length === 0;

  return (
    <div>
      <PageHeader title="New box" subtitle="A label number is assigned automatically." />
      {wanted && (
        <div className="card mb-3 border-accent/40 bg-accent-soft/40 p-3 text-sm">
          You scanned <LabelChip label={wanted} size="sm" /> but no box has that label yet.
        </div>
      )}
      <form onSubmit={submit} className="card space-y-4 p-4">
        <Field
          label="Series"
          hint="Each series is a letter with its own numbering (A-001, A-002 …)."
        >
          {series.isPending ? (
            <div className="skeleton h-11" />
          ) : noSeries ? (
            <p className="text-sm text-ink-mute">No series yet — create one below.</p>
          ) : (
            <select
              className="input"
              value={seriesId}
              onChange={(e) => setSeriesId(Number(e.target.value))}
              required
            >
              {(series.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.letter} — {s.description || 'no description'} (next: {s.letter}-
                  {String(s.nextNumber).padStart(3, '0')})
                </option>
              ))}
            </select>
          )}
        </Field>

        {wantedNumber && selected?.letter === wantedLetter && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={useExactNumber}
              onChange={(e) => setUseExactNumber(e.target.checked)}
            />
            Use the scanned number ({wanted}) instead of the next free one
          </label>
        )}

        <Field label="Name" hint="Optional, e.g. “Camping gear”. Printed on the label.">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="What's in it?"
            autoFocus
          />
        </Field>

        <Field label="Location">
          <select
            className="input"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">— none yet —</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="text-sm text-ink-mute">
            Label will be {previewLabel ? <LabelChip label={previewLabel} /> : '…'}
          </div>
          <button className="btn-primary" disabled={createBox.isPending || seriesId === ''}>
            {createBox.isPending ? <Spinner className="h-4 w-4" /> : null} Create box
          </button>
        </div>
      </form>

      <form
        onSubmit={addSeries}
        className={`card mt-4 space-y-3 p-4 ${noSeries ? 'border-accent/40' : ''}`}
      >
        <div className="text-sm font-semibold">
          {noSeries ? 'Create your first series' : 'Add another series'}
        </div>
        <div className="flex gap-2">
          <input
            className="input w-20 text-center font-mono uppercase"
            value={newLetter}
            onChange={(e) => setNewLetter(e.target.value.toUpperCase().slice(0, 1))}
            placeholder="A"
            maxLength={1}
            pattern="[A-Za-z]"
            required
            aria-label="Series letter"
          />
          <input
            className="input flex-1"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            maxLength={200}
          />
          <button className="btn-secondary" disabled={createSeries.isPending || !newLetter}>
            Add
          </button>
        </div>
        <p className="text-xs text-ink-mute">
          Manage series in{' '}
          <Link className="underline" to="/settings">
            Settings
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
