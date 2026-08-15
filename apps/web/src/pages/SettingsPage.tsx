import { useState, type FormEvent } from 'react';
import { download } from '@/api/client';
import {
  useChangePin,
  useCreateSeries,
  useDeleteSeries,
  useLabelTemplates,
  useLogout,
  useSeries,
  useSettings,
  useUpdateSeries,
  useUpdateSettings,
} from '@/api/hooks';
import { TrashIcon } from '@/components/AppShell';
import { ErrorNote, Field, LabelChip, PageHeader, Spinner } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

export function SettingsPage() {
  const settings = useSettings();
  const toast = useToast();

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      {settings.isError && (
        <ErrorNote message={errorMessage(settings.error)} retry={() => void settings.refetch()} />
      )}
      <SeriesSection />
      <AiSection />
      <LabelSection />
      <ExportSection onError={(e) => toast.error(errorMessage(e))} />
      <PinSection />
      <AboutSection />
    </div>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink-mute">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function SeriesSection() {
  const series = useSeries();
  const create = useCreateSeries();
  const update = useUpdateSeries();
  const remove = useDeleteSeries();
  const toast = useToast();
  const [letter, setLetter] = useState('');
  const [desc, setDesc] = useState('');

  const add = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { letter, description: desc.trim() || null },
      {
        onSuccess: () => {
          setLetter('');
          setDesc('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Section
      title="Label series"
      hint="Each series is a letter with its own auto-incrementing numbers. Boxes keep their label forever."
    >
      <ul className="divide-y divide-line">
        {(series.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <LabelChip label={s.letter} size="lg" />
            <div className="min-w-0 flex-1">
              <input
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink-mute"
                defaultValue={s.description ?? ''}
                placeholder="Description"
                maxLength={200}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (s.description ?? null))
                    update.mutate(
                      { id: s.id, description: v },
                      { onError: (err) => toast.error(errorMessage(err)) },
                    );
                }}
              />
              <div className="text-xs text-ink-mute">
                {s.boxCount ?? 0} box{s.boxCount === 1 ? '' : 'es'} · next {s.letter}-
                {String(s.nextNumber).padStart(3, '0')}
                <button
                  className="ml-2 underline"
                  onClick={() => {
                    const v = window.prompt(
                      `Next number for series ${s.letter} (must be above the highest used number):`,
                      String(s.nextNumber),
                    );
                    if (v === null) return;
                    const n = Number.parseInt(v, 10);
                    if (!Number.isFinite(n) || n < 1) return toast.error('Enter a positive number');
                    update.mutate(
                      { id: s.id, nextNumber: n },
                      { onError: (err) => toast.error(errorMessage(err)) },
                    );
                  }}
                >
                  change
                </button>
              </div>
            </div>
            <button
              className="btn-ghost btn-sm text-ink-mute hover:text-bad disabled:opacity-30"
              disabled={(s.boxCount ?? 0) > 0}
              title={(s.boxCount ?? 0) > 0 ? 'Delete its boxes first' : 'Delete series'}
              onClick={() => {
                if (window.confirm(`Delete series ${s.letter}?`))
                  remove.mutate(s.id, { onError: (err) => toast.error(errorMessage(err)) });
              }}
              aria-label={`Delete series ${s.letter}`}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </li>
        ))}
        {series.data?.length === 0 && (
          <li className="py-2 text-sm text-ink-mute">No series yet.</li>
        )}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input
          className="input w-16 text-center font-mono uppercase"
          value={letter}
          onChange={(e) => setLetter(e.target.value.toUpperCase().slice(0, 1))}
          placeholder="C"
          maxLength={1}
          pattern="[A-Za-z]"
          required
          aria-label="New series letter"
        />
        <input
          className="input flex-1"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description (optional)"
          maxLength={200}
        />
        <button className="btn-secondary" disabled={create.isPending || !letter}>
          Add
        </button>
      </form>
    </Section>
  );
}

function AiSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const [model, setModel] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return null;

  return (
    <Section
      title="AI photo analysis"
      hint={
        s.aiAvailable
          ? 'Photos are sent to the Anthropic API to list contents automatically.'
          : 'Disabled: set ANTHROPIC_API_KEY on the server to enable.'
      }
    >
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Analyze photos automatically on upload
          <span className="block text-xs text-ink-mute">
            Turn off to only analyze when you press “Re-run AI”.
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-accent"
          checked={s.aiAutoAnalyze}
          disabled={!s.aiAvailable || update.isPending}
          onChange={(e) =>
            update.mutate(
              { aiAutoAnalyze: e.target.checked },
              { onError: (err) => toast.error(errorMessage(err)) },
            )
          }
        />
      </label>
      <Field label="Model" hint="Any Claude model ID with vision, e.g. claude-sonnet-5.">
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono text-sm"
            value={model ?? s.aiModel}
            onChange={(e) => setModel(e.target.value)}
            disabled={!s.aiAvailable}
          />
          <button
            className="btn-secondary"
            disabled={
              !s.aiAvailable || model === null || model.trim() === s.aiModel || update.isPending
            }
            onClick={() =>
              update.mutate(
                { aiModel: (model ?? '').trim() },
                {
                  onSuccess: () => {
                    setModel(null);
                    toast.success('Model updated');
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            Save
          </button>
        </div>
      </Field>
    </Section>
  );
}

function LabelSection() {
  const settings = useSettings();
  const templates = useLabelTemplates();
  const update = useUpdateSettings();
  const toast = useToast();
  if (!settings.data) return null;
  return (
    <Section title="Labels" hint="Default sheet used by the print queue.">
      <select
        className="input"
        value={settings.data.defaultLabelTemplate}
        onChange={(e) =>
          update.mutate(
            { defaultLabelTemplate: e.target.value },
            { onError: (err) => toast.error(errorMessage(err)) },
          )
        }
      >
        {(templates.data?.templates ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-mute">
        QR codes link to{' '}
        <span className="font-mono">{settings.data.publicUrl}/b/&lt;label&gt;</span> (PUBLIC_URL on
        the server).
      </p>
    </Section>
  );
}

function ExportSection({ onError }: { onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (path: string, name: string) => {
    setBusy(path);
    try {
      await download(path, { filename: name });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="Export"
      hint="CSV files open cleanly in Excel / Numbers / Sheets. Combined = one row per item with its box details repeated."
    >
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void run('/api/export/boxes.csv', 'totetrack-boxes.csv')}
        >
          {busy === '/api/export/boxes.csv' ? <Spinner className="h-4 w-4" /> : null} Boxes (CSV)
        </button>
        <button
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void run('/api/export/items.csv', 'totetrack-items.csv')}
        >
          {busy === '/api/export/items.csv' ? <Spinner className="h-4 w-4" /> : null} Items (CSV)
        </button>
        <button
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void run('/api/export/inventory.csv', 'totetrack-inventory.csv')}
        >
          {busy === '/api/export/inventory.csv' ? <Spinner className="h-4 w-4" /> : null} Combined
          (CSV)
        </button>
      </div>
    </Section>
  );
}

function PinSection() {
  const change = useChangePin();
  const logout = useLogout();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast.error('New PINs do not match');
    change.mutate(
      { currentPin: current, newPin: next },
      {
        onSuccess: () => {
          toast.success('PIN changed. Devices already logged in stay logged in.');
          setCurrent('');
          setNext('');
          setConfirm('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Section
      title="Security"
      hint="One shared PIN for the household. Sessions last 30 days; changing the PIN does not log other devices out."
    >
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-3">
        <input
          className="input"
          type="password"
          inputMode="numeric"
          placeholder="Current PIN"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          minLength={4}
          autoComplete="current-password"
        />
        <input
          className="input"
          type="password"
          inputMode="numeric"
          placeholder="New PIN"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={4}
          autoComplete="new-password"
        />
        <input
          className="input"
          type="password"
          inputMode="numeric"
          placeholder="Confirm new PIN"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={4}
          autoComplete="new-password"
        />
        <div className="sm:col-span-3 flex justify-between">
          <button type="button" className="btn-ghost" onClick={() => logout.mutate()}>
            Log out on this device
          </button>
          <button
            className="btn-primary"
            disabled={change.isPending || !current || next.length < 4}
          >
            Change PIN
          </button>
        </div>
      </form>
    </Section>
  );
}

function AboutSection() {
  const settings = useSettings();
  return (
    <p className="px-1 text-center text-xs text-ink-mute">
      ToteTrack {settings.data?.version ?? ''} · self-hosted home inventory
    </p>
  );
}
