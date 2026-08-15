import { normalizeLabelId } from '@totetrack/shared';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBoxByLabel } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { EmptyState, ErrorNote, LabelChip, Spinner } from '@/components/ui';

/** Target of QR codes: /b/:labelId → the box page. */
export function LabelResolvePage() {
  const { labelId } = useParams();
  const normalized = normalizeLabelId(labelId ?? '');
  const navigate = useNavigate();
  const box = useBoxByLabel(normalized ?? undefined);

  useEffect(() => {
    if (box.data) navigate(`/boxes/${box.data.id}`, { replace: true });
  }, [box.data, navigate]);

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
  if (box.isPending || box.data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-ink-mute">
        <Spinner />
        <span className="text-sm">
          Looking up <LabelChip label={normalized} size="sm" />…
        </span>
      </div>
    );
  }
  if (box.error instanceof ApiError && box.error.status === 404) {
    return (
      <EmptyState
        title={`No box labelled ${normalized}`}
        body="This label isn't in the inventory yet — maybe the box was deleted, or the label was printed ahead of time."
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
  return <ErrorNote message="Could not look up that label" retry={() => void box.refetch()} />;
}
