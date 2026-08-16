import type { Item, ItemCreateInput, ItemUpdateInput } from '@totetrack/shared';
import { useState, type FormEvent } from 'react';
import { CameraIcon, SparkIcon, TrashIcon } from './AppShell';

export function ItemList({
  items,
  onCreate,
  onUpdate,
  onDelete,
  onDeleteAllAi,
  onShowPhoto,
  onMove,
  livePhotoIds,
  busy,
}: {
  items: Item[];
  onCreate: (input: ItemCreateInput) => Promise<unknown>;
  onUpdate: (id: number, input: ItemUpdateInput) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  onDeleteAllAi: () => Promise<unknown>;
  /** Jump to the photo an AI item was found in. */
  onShowPhoto?: (photoId: number) => void;
  /** Move the item to another box (opens a picker). */
  onMove?: (item: Item) => void;
  /** Photos currently on the box — items linked to other (trashed) photos get no jump button. */
  livePhotoIds?: Set<number>;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const aiCount = items.filter((i) => i.source === 'ai').length;

  return (
    <div className="card">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-sm font-semibold">
          Items <span className="font-normal text-ink-mute">({items.length})</span>
        </h2>
        {aiCount > 0 && (
          <button
            type="button"
            className="btn-ghost btn-sm text-xs text-bad"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Remove all ${aiCount} AI-suggested item${aiCount === 1 ? '' : 's'}? Manual items are kept.`,
                )
              )
                void onDeleteAllAi();
            }}
          >
            Clear AI items
          </button>
        )}
      </div>
      <ul className="divide-y divide-line px-2 pt-1">
        {items.length === 0 && (
          <li className="px-2 py-4 text-sm text-ink-mute">
            No items yet. Add one below or upload a photo for AI suggestions.
          </li>
        )}
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id} className="px-2 py-2">
              <ItemForm
                initial={item}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onMove={
                  onMove
                    ? () => {
                        setEditing(null);
                        onMove(item);
                      }
                    : undefined
                }
                onSubmit={async (input) => {
                  await onUpdate(item.id, input);
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={item.id} className="flex items-start gap-2 px-2 py-2.5">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing(item.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium">{item.name}</span>
                  {item.qty !== 1 && (
                    <span className="rounded-md bg-paper-sunk px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                      ×{item.qty}
                    </span>
                  )}
                  {item.source === 'ai' && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-deep"
                      title="Suggested by AI"
                    >
                      <SparkIcon className="h-3 w-3" /> AI
                    </span>
                  )}
                </div>
                {item.note && <div className="mt-0.5 text-xs text-ink-mute">{item.note}</div>}
              </button>
              {onShowPhoto && item.photoId && livePhotoIds?.has(item.photoId) && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-ink-mute"
                  aria-label={`Show the photo ${item.name} was found in`}
                  title="Show in photo"
                  onClick={() => onShowPhoto(item.photoId!)}
                >
                  <CameraIcon className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm text-ink-mute hover:text-bad"
                disabled={busy}
                aria-label={`Delete ${item.name}`}
                onClick={() => void onDelete(item.id)}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ),
        )}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <ItemForm submitLabel="Add item" onSubmit={onCreate} compact />
      </div>
    </div>
  );
}

function ItemForm({
  initial,
  onSubmit,
  onCancel,
  onMove,
  submitLabel,
  compact,
}: {
  initial?: Item;
  onSubmit: (input: ItemCreateInput) => Promise<unknown>;
  onCancel?: () => void;
  onMove?: () => void;
  submitLabel: string;
  compact?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [qty, setQty] = useState(String(initial?.qty ?? 1));
  const [note, setNote] = useState(initial?.note ?? '');
  const [showNote, setShowNote] = useState(!compact || Boolean(initial?.note));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        qty: Math.max(0, Number.parseInt(qty || '1', 10) || 0),
        note: note.trim() || null,
      });
      if (!initial) {
        setName('');
        setQty('1');
        setNote('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={compact ? 'Add an item…' : 'Item name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={300}
          enterKeyHint="done"
          autoFocus={Boolean(initial)}
        />
        <input
          className="input w-20 text-center"
          type="number"
          inputMode="numeric"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label="Quantity"
        />
      </div>
      {showNote ? (
        <input
          className="input"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
        />
      ) : (
        <button
          type="button"
          className="text-xs text-ink-mute underline"
          onClick={() => setShowNote(true)}
        >
          + add a note
        </button>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onMove && (
          <button type="button" className="btn-ghost btn-sm mr-auto text-xs" onClick={onMove}>
            Move to another box…
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className={`${compact ? 'btn-secondary' : 'btn-primary'} btn-sm`}
          disabled={saving || !name.trim()}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
