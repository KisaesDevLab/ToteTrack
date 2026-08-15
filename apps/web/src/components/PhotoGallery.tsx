import type { Photo } from '@totetrack/shared';
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useState } from 'react';
import { AiPill, Spinner } from './ui';
import { ChevronLeft, SparkIcon, TrashIcon } from './AppShell';

export function PhotoGallery({
  photos,
  onDelete,
  onReorder,
  onAnalyze,
  aiAvailable,
  busy,
}: {
  photos: Photo[];
  onDelete: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onAnalyze: (id: number) => void;
  aiAvailable: boolean;
  busy?: boolean;
}) {
  const [emblaRef, embla] = useEmblaCarousel({ loop: false, align: 'start' });
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setIndex(embla.selectedScrollSnap());
    embla.on('select', onSelect);
    onSelect();
    return () => {
      embla.off('select', onSelect);
    };
  }, [embla]);

  useEffect(() => {
    embla?.reInit();
  }, [embla, photos.length]);

  const move = useCallback(
    (from: number, dir: -1 | 1) => {
      const to = from + dir;
      if (to < 0 || to >= photos.length) return;
      const ids = photos.map((p) => p.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved!);
      onReorder(ids);
      embla?.scrollTo(to);
    },
    [photos, onReorder, embla],
  );

  if (!photos.length) return null;
  const current = photos[index] ?? photos[0]!;

  return (
    <div className="card overflow-hidden">
      <div className="embla bg-ink" ref={emblaRef}>
        <div className="embla__container">
          {photos.map((p, i) => (
            <div className="embla__slide" key={p.id}>
              <button
                type="button"
                className="block aspect-[4/3] w-full"
                onClick={() => setLightbox(i)}
                aria-label={`Open photo ${i + 1} full screen`}
              >
                <img
                  src={p.thumbUrl}
                  srcSet={`${p.thumbUrl} 400w, ${p.originalUrl} 1600w`}
                  sizes="(max-width: 768px) 100vw, 768px"
                  alt={`Box photo ${i + 1}`}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="h-full w-full object-contain"
                />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-ink-mute">
          <span className="font-mono">
            {index + 1}/{photos.length}
          </span>
          <AiPill status={current.aiStatus} error={current.aiError} />
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-sm"
            disabled={index === 0 || busy}
            onClick={() => move(index, -1)}
            aria-label="Move photo earlier"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-sm"
            disabled={index >= photos.length - 1 || busy}
            onClick={() => move(index, 1)}
            aria-label="Move photo later"
          >
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </button>
          {aiAvailable && (
            <button
              className="btn-ghost btn-sm"
              disabled={busy || current.aiStatus === 'pending'}
              onClick={() => onAnalyze(current.id)}
              title="Re-run AI on this photo"
            >
              {current.aiStatus === 'pending' ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <SparkIcon className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            className="btn-ghost btn-sm text-bad"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Delete this photo? AI items found in it will be removed too.'))
                onDelete(current.id);
            }}
            aria-label="Delete photo"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => embla?.scrollTo(i)}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${i === index ? 'border-accent' : 'border-transparent'}`}
              aria-label={`Show photo ${i + 1}`}
            >
              <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {lightbox !== null && (
        <Lightbox photos={photos} start={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function Lightbox({
  photos,
  start,
  onClose,
}: {
  photos: Photo[];
  start: number;
  onClose: () => void;
}) {
  const [emblaRef, embla] = useEmblaCarousel({ startIndex: start, loop: photos.length > 1 });
  const [index, setIndex] = useState(start);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setIndex(embla.selectedScrollSnap());
    embla.on('select', onSelect);
    return () => {
      embla.off('select', onSelect);
    };
  }, [embla]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') embla?.scrollNext();
      if (e.key === 'ArrowLeft') embla?.scrollPrev();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [embla, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-sm opacity-80">
          {index + 1}/{photos.length}
        </span>
        <button
          className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="embla flex-1" ref={emblaRef}>
        <div className="embla__container h-full">
          {photos.map((p, i) => (
            <div className="embla__slide flex h-full items-center justify-center" key={p.id}>
              <img
                src={p.originalUrl}
                alt={`Box photo ${i + 1}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-6 py-3">
        <button
          className="rounded-full bg-white/10 p-3"
          onClick={() => embla?.scrollPrev()}
          aria-label="Previous photo"
        >
          <ChevronLeft />
        </button>
        <a
          href={photos[index]?.originalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline opacity-80"
        >
          Open original
        </a>
        <button
          className="rounded-full bg-white/10 p-3"
          onClick={() => embla?.scrollNext()}
          aria-label="Next photo"
        >
          <ChevronLeft className="rotate-180" />
        </button>
      </div>
    </div>
  );
}
