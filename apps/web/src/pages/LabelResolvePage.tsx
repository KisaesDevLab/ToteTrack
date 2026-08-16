import { normalizeLabelId } from '@totetrack/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateBox, useLabelLookup, useSettings } from '@/api/hooks';
import { EmptyState, ErrorNote, LabelChip, Spinner } from '@/components/ui';
import { errorMessage, useToast } from '@/lib/toast';

/**
 * Target of QR codes: /b/:labelId.
 * - existing box → box page
 * - pre-printed (unclaimed) label → create the box with that exact number and open it in capture mode
 * - unknown label in a known series → offer to create it
 */
export function LabelResolvePage() {
  const { labelId } = useParams();
  const normalized = normalizeLabelId(labelId ?? '');
  const navigate = useNavigate();
  const toast = useToast();
  const lookup = useLabelLookup(normalized ?? undefined);
  const settings = useSettings();
  const create = useCreateBox();
  const started = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createBox = create.mutate;

  useEffect(() => {
    const data = lookup.data;
    if (!data || started.current || createError) return;
    if (data.box) {
      if (settings.isPending) return; // need the scanOpensCamera preference first
      started.current = true;
      const capture = settings.data?.scanOpensCamera !== false ? '?capture=1' : '';
      navigate(`/boxes/${data.box.id}${capture}`, { replace: true });
      return;
    }
    if (data.preprinted && !data.preprinted.claimedBoxId && data.seriesId) {
      started.current = true;
      createBox(
        { seriesId: data.seriesId, number: data.preprinted.number },
        {
          onSuccess: (box) => {
            toast.success(`Created ${box.labelId} — take a photo of the contents`);
            navigate(`/boxes/${box.id}?capture=1`, { replace: true });
          },
          // No automatic retry: another phone may have claimed the label a moment ago (409), or the
          // server may be unreachable. Show the error and let the user re-check.
          onError: (err) => setCreateError(errorMessage(err)),
        },
      );
    }
  }, [
    lookup.data,
    navigate,
    createBox,
    createError,
    toast,
    settings.isPending,
    settings.data?.scanOpensCamera,
  ]);

  if (!normalized) {
    return (
      <EmptyState
        title="That doesn't look like a label"
        body={`“${labelId}” isn't a valid box label.`}
        action={
          <Link to="/" className="btn-primary">
            Go home
          </Link>
        }
      />
    );
  }
  if (lookup.isError) {
    return <ErrorNote message="Could not look up that label" retry={() => void lookup.refetch()} />;
  }
  if (createError) {
    return (
      <ErrorNote
        message={`Could not set up box ${normalized}: ${createError}`}
        retry={() => {
          // Re-check the label: if another device already created the box we simply open it.
          started.current = false;
          setCreateError(null);
          void lookup.refetch();
        }}
      />
    );
  }
  const data = lookup.data;
  const settingUp =
    !data || data.box || (data.preprinted && !data.preprinted.claimedBoxId && data.seriesId);
  if (settingUp) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-ink-mute">
        <Spinner />
        <span className="text-sm">
          {data?.preprinted ? (
            <>
              Setting up box <LabelChip label={normalized} size="sm" />…
            </>
          ) : (
            <>
              Looking up <LabelChip label={normalized} size="sm" />…
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <EmptyState
      title={`No box labelled ${normalized}`}
      body={
        data.seriesId
          ? 'This label isn’t in the inventory yet — maybe the box was deleted, or the label was printed elsewhere.'
          : `There is no series “${normalized[0]}” yet. Create the series in Settings first, or create the box and a series will be added.`
      }
      action={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to={`/boxes/new?label=${encodeURIComponent(normalized)}`} className="btn-primary">
            Create box {normalized}
          </Link>
          <Link to="/" className="btn-secondary">
            Search instead
          </Link>
        </div>
      }
    />
  );
}
