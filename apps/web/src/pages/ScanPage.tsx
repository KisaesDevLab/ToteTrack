import { normalizeLabelId } from '@totetrack/shared';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CameraIcon } from '@/components/AppShell';
import { LabelChip, PageHeader } from '@/components/ui';

/** Pull a label out of whatever the QR contained: our deep link (…/b/A-014) or plain text like "A-014". */
export function labelFromScan(text: string): string | null {
  const m = /\/b\/([^/?#\s]+)/i.exec(text);
  if (m) return normalizeLabelId(decodeURIComponent(m[1]!));
  return normalizeLabelId(text);
}

type BarcodeDetectorLike = {
  detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * In-app scanner: live camera preview that reads the label's QR (or printed text via manual entry)
 * and jumps to the box — no switching to the phone's camera app between totes.
 */
export function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'found' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [found, setFound] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const go = useCallback(
    (label: string) => {
      setFound(label);
      setStatus('found');
      stop();
      if (navigator.vibrate) navigator.vibrate(60);
      navigate(`/b/${encodeURIComponent(label)}`, { replace: true });
    },
    [navigate, stop],
  );

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          window.isSecureContext
            ? 'This browser cannot access the camera.'
            : 'Camera access needs a secure (https) connection — open ToteTrack through your tunnel hostname, or type the label below.',
        );
        setStatus('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(caps.torch ? false : null);
        setStatus('scanning');
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in your browser settings, or type the label below.'
            : `Could not start the camera (${err instanceof Error ? err.message : 'unknown error'}).`,
        );
        setStatus('error');
        return;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const tick = async (t: number) => {
        if (cancelled) return;
        // ~8 decodes/second is plenty and keeps phones cool.
        if (t - last > 120 && video.readyState >= 2 && video.videoWidth) {
          last = t;
          const w = video.videoWidth;
          const h = video.videoHeight;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          let text: string | null = null;
          if (detector) {
            try {
              const codes = await detector.detect(canvas);
              text = codes[0]?.rawValue ?? null;
            } catch {
              /* fall through to jsQR */
            }
          }
          if (!text) {
            const img = ctx.getImageData(0, 0, w, h);
            text = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (text) {
            const label = labelFromScan(text);
            if (label) return go(label);
          }
        }
        raf = requestAnimationFrame((n) => void tick(n));
      };
      raf = requestAnimationFrame((n) => void tick(n));
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stop();
    };
  }, [go, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      /* unsupported */
    }
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const label = labelFromScan(manual);
    if (!label) return setError('Enter a label like A-014');
    go(label);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Scan a label" subtitle="Point the camera at a tote's QR code." />
      <div className="relative overflow-hidden rounded-2xl bg-ink">
        <video ref={videoRef} className="aspect-[3/4] w-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className={`h-56 w-56 rounded-2xl border-4 ${
              status === 'found' ? 'border-good' : 'border-white/80'
            } shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent p-3 text-xs text-white">
          <span>
            {status === 'starting' && 'Starting camera…'}
            {status === 'scanning' && 'Looking for a QR code…'}
            {status === 'found' && found && (
              <>
                Found <LabelChip label={found} size="sm" />
              </>
            )}
            {status === 'error' && 'Camera unavailable'}
          </span>
          {torch !== null && (
            <button
              type="button"
              className="rounded-full bg-white/15 px-3 py-1.5 font-semibold"
              onClick={() => void toggleTorch()}
            >
              {torch ? 'Torch off' : 'Torch on'}
            </button>
          )}
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{error}</p>}

      <form onSubmit={submitManual} className="card p-3">
        <label className="mb-1 block text-xs font-medium text-ink-soft">
          Or type the label printed on the tote
        </label>
        <div className="flex gap-2">
          <input
            className="input font-mono uppercase"
            placeholder="A-014"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button className="btn-primary" disabled={!manual.trim()}>
            Open
          </button>
        </div>
      </form>
      <p className="text-center text-xs text-ink-mute">
        <CameraIcon className="mr-1 inline h-3.5 w-3.5" />
        Tip: the phone's own camera app also opens labels — this scanner just keeps you in the app
        between totes.
      </p>
    </div>
  );
}
