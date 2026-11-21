import { Camera, Flashlight } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { playScanSound } from '../pages/counter/scanSound';
import { aimArea } from '../utils/cameraAim';
import { codeFromScan } from '../utils/scanLinks';
import { Button, Sheet } from './ui';

/** Product barcodes, the Code 128 some suppliers print, and the shop's own QR codes. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'];
const SCAN_EVERY_MS = 200;
/** A code counts again only after it has been out of sight this long: one held in view goes in once. */
const GONE_MS = 1000;
/** Frames are scaled down to this width before decoding: sharp enough for a label, quick on a phone. */
const MAX_FRAME_WIDTH = 1280;
interface Detector {
  detect(source: ImageData): Promise<Array<{ rawValue: string }>>;
}

/** The browser's own barcode reader where there is one (Chrome on Android), otherwise the bundled one (Safari on iPhone). */
async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (Native) {
    const supported = await Native.getSupportedFormats();
    if (FORMATS.every((format) => supported.includes(format))) return new Native({ formats: FORMATS });
  }
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  // The decoder is served from the dashboard itself (copied there on install), not from a CDN.
  setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path) });
  return new BarcodeDetector({ formats: FORMATS as never });
}

/** What happened to the last code, shown under the picture while scanning on. */
export interface ScanStatus {
  tone: 'ok' | 'fail' | 'busy';
  text: string;
}

/**
 * The phone or laptop camera as a barcode scanner. Each frame's aim box is
 * drawn onto a canvas and decoded: the one way that works the same in every
 * browser, Safari on iPhone included. `onScan` gets each code once while it
 * stays in view, and again only after it has left the picture; reads wait
 * for the one before to finish. A read buzzes the phone (and beeps, unless
 * `beep` is off because the page makes its own sound).
 */
export function CameraView({ onScan, status, beep = true }: { onScan: (code: string) => void | Promise<void>; status?: ScanStatus | null; beep?: boolean }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const beepRef = useRef(beep);
  useEffect(() => {
    onScanRef.current = onScan;
    beepRef.current = beep;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const seen = new Map<string, number>();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (error) {
        setProblem((error as Error).name === 'NotAllowedError' ? t.staff.camera.denied : t.staff.camera.failed((error as Error).message));
        return;
      }
      if (stopped || !video.current) return stream.getTracks().forEach((track) => track.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      // A light to switch on (Chrome on Android); the DOM types don't know `torch` yet.
      if (track && (track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch({ track, on: false });

      let detector: Detector;
      try {
        detector = await createDetector();
      } catch (error) {
        setProblem(t.staff.camera.readFailed((error as Error).message));
        return;
      }

      const scan = async () => {
        if (stopped) return;
        const element = video.current;
        if (element && context && element.readyState >= element.HAVE_CURRENT_DATA && element.videoWidth > 0 && element.clientWidth > 0) {
          // Only the aim box is read: a quarter of the work, and a code beside it isn't taken by mistake.
          const area = aimArea({ width: element.videoWidth, height: element.videoHeight }, { width: element.clientWidth, height: element.clientHeight });
          const scale = Math.min(1, MAX_FRAME_WIDTH / area.width);
          canvas.width = Math.round(area.width * scale);
          canvas.height = Math.round(area.height * scale);
          context.drawImage(element, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
          try {
            const now = Date.now();
            for (const result of await detector.detect(context.getImageData(0, 0, canvas.width, canvas.height))) {
              const code = codeFromScan(result.rawValue);
              const before = seen.get(code) ?? Number.NEGATIVE_INFINITY;
              seen.set(code, now);
              // Still in view since last time, or the one before is still going in: not again.
              if (now - before < GONE_MS || busy || stopped) continue;
              navigator.vibrate?.(40);
              if (beepRef.current) playScanSound('ok');
              busy = true;
              try {
                await onScanRef.current(code);
              } finally {
                busy = false;
              }
            }
            setProblem(null);
          } catch (error) {
            setProblem(t.staff.camera.readFailed((error as Error).message));
          }
        }
        timer = setTimeout(scan, SCAN_EVERY_MS);
      };
      void scan();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [t]);

  async function switchTorch() {
    if (!torch) return;
    const on = !torch.on;
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ ...torch, on });
    } catch {
      setTorch(null);
    }
  }

  const line = problem ? { tone: 'fail' as const, text: problem } : (status ?? null);
  return (
    <div className="camera-view">
      <div className="camera-view__picture">
        {/* playsInline keeps iPhone Safari from opening the camera full screen. */}
        <video ref={video} className="camera-view__video" playsInline muted autoPlay aria-label={t.staff.camera.title} />
        <span className="camera-view__aim" aria-hidden="true" />
        {torch && (
          <span className="camera-view__torch">
            <Button size="sm" icon={Flashlight} aria-pressed={torch.on} onClick={() => void switchTorch()}>
              {torch.on ? t.staff.camera.torchOff : t.staff.camera.torchOn}
            </Button>
          </span>
        )}
      </div>
      <p className={line ? `camera-view__hint camera-view__hint--${line.tone}` : 'camera-view__hint'} role="status">
        {line?.text ?? t.staff.camera.hint}
      </p>
    </div>
  );
}

/**
 * The camera in a card that stays open: each code read goes to `onScan`, and
 * `status` says what came of it ("Added: … ×2"); Done closes it. For the till,
 * where one product after another goes in.
 */
export function CameraScanSheet({
  open,
  onClose,
  onScan,
  status,
  beep,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void | Promise<void>;
  status?: ScanStatus | null;
  beep?: boolean;
}) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.staff.camera.title} description={t.staff.camera.keepHint} guard={false}>
      {open && <CameraView onScan={onScan} status={status} beep={beep} />}
      <div className="form-actions">
        <Button variant="primary" onClick={onClose}>
          {t.staff.camera.done}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * A "Scan with the camera" key that opens the camera in a panel; the first
 * code read closes it and goes to `onScan`. For one code at a time (find a
 * product, fill a barcode field).
 */
export function CameraScanButton({
  onScan,
  label,
  size,
  iconOnly,
  className,
}: {
  onScan: (code: string) => void;
  label?: string;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = label ?? t.staff.camera.open;
  return (
    <>
      <Button
        icon={Camera}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? text : undefined}
        title={iconOnly ? text : undefined}
      >
        {iconOnly ? undefined : text}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.staff.camera.title}>
        {open && (
          <CameraView
            onScan={(code) => {
              setOpen(false);
              onScan(code);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
