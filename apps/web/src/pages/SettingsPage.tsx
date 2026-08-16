import { useState, type FormEvent } from 'react';
import { download } from '@/api/client';
import {
  useChangePin,
  useCreateSeries,
  useDeleteSeries,
  useLabelTemplates,
  useLogout,
  useRestartTunnel,
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
      <TunnelSection />
      <PublicUrlSection />
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
                {s.boxCount ?? 0} box{s.boxCount === 1 ? '' : 'es'}
                {s.unclaimedLabels
                  ? ` · ${s.unclaimedLabels} pre-printed label${s.unclaimedLabels === 1 ? '' : 's'} waiting`
                  : ''}
                {' · next '}
                {s.letter}-{String(s.nextNumber).padStart(3, '0')}
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
  const [keyDraft, setKeyDraft] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return null;

  const onErr = (err: unknown) => toast.error(errorMessage(err));
  const keyStatus =
    s.aiKeySource === 'env'
      ? `Using the ANTHROPIC_API_KEY environment variable (${s.aiKeyHint}). It overrides any key entered here.`
      : s.aiKeySource === 'settings'
        ? `Key saved in Settings (${s.aiKeyHint}).`
        : 'No API key configured — AI analysis is off.';

  return (
    <Section
      title="AI photo analysis"
      hint={
        s.aiAvailable
          ? 'Photos are sent to the Anthropic API to list contents automatically.'
          : 'Add an Anthropic API key below (or set ANTHROPIC_API_KEY on the server) to enable.'
      }
    >
      <Field label="Anthropic API key" hint={keyStatus}>
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono text-sm"
            type="password"
            autoComplete="off"
            placeholder={s.aiKeySource === 'settings' ? 'Enter a new key to replace' : 'sk-ant-…'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            disabled={s.aiKeySource === 'env'}
          />
          <button
            className="btn-secondary"
            disabled={s.aiKeySource === 'env' || keyDraft.trim().length < 10 || update.isPending}
            onClick={() =>
              update.mutate(
                { anthropicApiKey: keyDraft.trim() },
                {
                  onSuccess: () => {
                    setKeyDraft('');
                    toast.success('API key saved');
                  },
                  onError: onErr,
                },
              )
            }
          >
            Save key
          </button>
          {s.aiKeySource === 'settings' && (
            <button
              className="btn-danger btn-sm"
              disabled={update.isPending}
              onClick={() => {
                if (window.confirm('Remove the stored API key? AI analysis will stop.'))
                  update.mutate({ anthropicApiKey: null }, { onError: onErr });
              }}
            >
              Remove
            </button>
          )}
        </div>
      </Field>

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
          onChange={(e) => update.mutate({ aiAutoAnalyze: e.target.checked }, { onError: onErr })}
        />
      </label>

      <Field label="Model" hint="Any Claude model ID with vision, e.g. claude-sonnet-5.">
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono text-sm"
            value={model ?? s.aiModel}
            onChange={(e) => setModel(e.target.value)}
          />
          <button
            className="btn-secondary"
            disabled={model === null || model.trim() === s.aiModel || update.isPending}
            onClick={() =>
              update.mutate(
                { aiModel: (model ?? '').trim() },
                {
                  onSuccess: () => {
                    setModel(null);
                    toast.success('Model updated');
                  },
                  onError: onErr,
                },
              )
            }
          >
            Save
          </button>
        </div>
      </Field>

      <Field
        label="Instructions sent with each photo"
        hint={
          s.aiSystemPromptCustom
            ? 'Custom prompt in use. The model must still answer with the JSON shape described.'
            : 'Built-in default. Edit to change tone, grouping rules or level of detail — keep the JSON shape.'
        }
      >
        <textarea
          className="input min-h-[160px] resize-y font-mono text-xs leading-relaxed"
          value={prompt ?? s.aiSystemPrompt}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
        />
        <div className="mt-2 flex justify-end gap-2">
          {(s.aiSystemPromptCustom || prompt !== null) && (
            <button
              className="btn-ghost btn-sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { aiSystemPrompt: null },
                  {
                    onSuccess: () => {
                      setPrompt(null);
                      toast.success('Prompt reset to default');
                    },
                    onError: onErr,
                  },
                )
              }
            >
              Reset to default
            </button>
          )}
          <button
            className="btn-secondary btn-sm"
            disabled={
              prompt === null || prompt.trim() === s.aiSystemPrompt.trim() || update.isPending
            }
            onClick={() =>
              update.mutate(
                { aiSystemPrompt: (prompt ?? '').trim() || null },
                {
                  onSuccess: () => {
                    setPrompt(null);
                    toast.success('Prompt saved');
                  },
                  onError: onErr,
                },
              )
            }
          >
            Save prompt
          </button>
        </div>
      </Field>
    </Section>
  );
}

function TunnelSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const restart = useRestartTunnel();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [showLog, setShowLog] = useState(false);
  const s = settings.data;
  if (!s) return null;
  const t = s.tunnel;
  const onErr = (err: unknown) => toast.error(errorMessage(err));

  const pill =
    t.state === 'connected'
      ? { cls: 'bg-green-50 text-good', text: 'Connected' }
      : t.state === 'starting'
        ? { cls: 'bg-accent-soft text-accent-deep', text: 'Connecting…' }
        : t.state === 'error'
          ? { cls: 'bg-red-50 text-bad', text: 'Error' }
          : t.state === 'unavailable'
            ? { cls: 'bg-red-50 text-bad', text: 'Connector missing' }
            : { cls: 'bg-paper-sunk text-ink-soft', text: 'Off' };

  return (
    <Section
      title="Remote access (Cloudflare Tunnel)"
      hint="Reach ToteTrack from anywhere — and let phone cameras open QR links — without opening ports. The app runs the Cloudflare connector for you."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`pill ${pill.cls}`}>{pill.text}</span>
        {t.connectedSince && (
          <span className="text-xs text-ink-mute">
            since {new Date(t.connectedSince).toLocaleTimeString()}
          </span>
        )}
        {t.tokenSource === 'env' && (
          <span className="text-xs text-ink-mute">token from CLOUDFLARE_TUNNEL_TOKEN (env)</span>
        )}
        {t.restarts > 0 && <span className="text-xs text-ink-mute">restarts: {t.restarts}</span>}
      </div>
      {t.lastError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-bad">{t.lastError}</p>
      )}

      <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-mute">
        <li>
          In Cloudflare Zero Trust go to <b>Networks → Tunnels → Create a tunnel</b> (Cloudflared).
        </li>
        <li>
          Add a <b>Public Hostname</b> (e.g. totes.example.com) with service type <b>HTTP</b> and
          URL <span className="font-mono">localhost:3000</span> — the connector runs inside the app.
        </li>
        <li>Copy the connector token from the install command and paste it below.</li>
        <li>
          Open the app on that hostname once — QR codes pick the address up automatically (or pin it
          under Public address below).
        </li>
      </ol>

      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono text-sm"
          type="password"
          autoComplete="off"
          placeholder={t.tokenSource === 'settings' ? 'Paste a new token to replace' : 'eyJhIjoi…'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={t.tokenSource === 'env'}
        />
        <button
          className="btn-secondary"
          disabled={t.tokenSource === 'env' || token.trim().length < 20 || update.isPending}
          onClick={() =>
            update.mutate(
              { cloudflareTunnelToken: token.trim() },
              {
                onSuccess: () => {
                  setToken('');
                  toast.success('Token saved — starting the tunnel');
                },
                onError: onErr,
              },
            )
          }
        >
          Save token
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {t.tokenSource !== 'none' && (
          <button
            className="btn-secondary btn-sm"
            disabled={restart.isPending}
            onClick={() => restart.mutate(undefined, { onError: onErr })}
          >
            {restart.isPending ? <Spinner className="h-4 w-4" /> : null} Restart connector
          </button>
        )}
        {t.tokenSource === 'settings' && (
          <button
            className="btn-danger btn-sm"
            disabled={update.isPending}
            onClick={() => {
              if (window.confirm('Remove the tunnel token and stop remote access?'))
                update.mutate({ cloudflareTunnelToken: null }, { onError: onErr });
            }}
          >
            Remove token
          </button>
        )}
        {t.log.length > 0 && (
          <button className="btn-ghost btn-sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide log' : 'Show connector log'}
          </button>
        )}
      </div>
      {showLog && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper">
          {t.log.join('\n')}
        </pre>
      )}
    </Section>
  );
}

function PublicUrlSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return null;
  const onErr = (err: unknown) => toast.error(errorMessage(err));

  return (
    <Section
      title="Public address"
      hint="The origin printed inside every QR code. Change it here when your Cloudflare hostname changes — no redeploy needed."
    >
      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono text-sm"
          inputMode="url"
          autoCapitalize="none"
          placeholder="https://totes.example.com"
          value={draft ?? s.publicUrl}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="btn-secondary"
          disabled={draft === null || draft.trim() === s.publicUrl || update.isPending}
          onClick={() =>
            update.mutate(
              { publicUrl: draft!.trim() },
              {
                onSuccess: () => {
                  setDraft(null);
                  toast.success(
                    'Public address updated — labels printed earlier keep the old link',
                  );
                },
                onError: onErr,
              },
            )
          }
        >
          Save
        </button>
      </div>
      <p className="text-xs text-ink-mute">
        QR codes link to <span className="font-mono">{s.publicUrl}/b/&lt;label&gt;</span>.
        {s.publicUrlCustom ? (
          <>
            {' '}
            <button
              className="underline"
              onClick={() =>
                update.mutate(
                  { publicUrl: null },
                  { onSuccess: () => setDraft(null), onError: onErr },
                )
              }
            >
              Clear the override
            </button>{' '}
            to go back to{' '}
            {s.publicUrlEnv
              ? 'the server default'
              : 'auto-detecting it from the address you browse on'}
            .
          </>
        ) : s.publicUrlSource === 'env' ? (
          ' Currently taken from the PUBLIC_URL environment variable.'
        ) : (
          ' Auto-detected from the address you are using right now — set it explicitly if you print labels from more than one address.'
        )}
      </p>
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
    <Section
      title="Labels & scanning"
      hint="Default sheet used by the print queue, and what happens after a scan."
    >
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Open the camera panel after scanning a label
          <span className="block text-xs text-ink-mute">
            Scan → box opens with Scan/Rescan ready, one tap from taking the photo. Turn off to just
            view the box.
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-accent"
          checked={settings.data.scanOpensCamera}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate(
              { scanOpensCamera: e.target.checked },
              { onError: (err) => toast.error(errorMessage(err)) },
            )
          }
        />
      </label>
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
