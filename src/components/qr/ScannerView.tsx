import { Flashlight, FlashlightOff, SwitchCamera, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useT } from '@/i18n';
import { FrameCollector } from '@/lib/qr/frames';
import { useQrScanner, type ScannerStatus } from '@/lib/qr/useQrScanner';
import { ScannerManualInput } from './ScannerManualInput';

export interface ScannerViewProps {
  /** Called once per scan with the complete text (multi-frame payloads are assembled first). */
  onResult: (text: string) => void;
}

const PROBLEM_KEY: Partial<Record<ScannerStatus, string>> = {
  denied: 'qr.denied',
  'no-camera': 'qr.noCamera',
  insecure: 'qr.insecure',
  busy: 'qr.cameraBusy',
  error: 'qr.cameraError',
};

const RESUME_MS = 1500;

interface Progress {
  received: number;
  total: number;
}

/** Camera preview with decoding; mounted only while the scanner dialog is open. */
export const ScannerView: React.FC<ScannerViewProps> = ({ onResult }) => {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const collector = useMemo(() => new FrameCollector(), []);
  const doneRef = useRef(false);
  const lastRef = useRef('');
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const resumeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resumeRef.current), []);

  const handleText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      // The same frame is decoded many times per second – process each distinct text once.
      if (doneRef.current || !text || text === lastRef.current) return;
      lastRef.current = text;
      const res = collector.add(text);
      if (res.complete && res.text !== undefined) {
        doneRef.current = true;
        setDone(true);
        setProgress(null);
        navigator.vibrate?.(40);
        onResult(res.text);
        // Normally the parent closes the dialog now. If it rejected the code and stays open, resume.
        resumeRef.current = setTimeout(() => {
          doneRef.current = false;
          lastRef.current = '';
          setDone(false);
        }, RESUME_MS);
        return;
      }
      if (res.isFrame) setProgress({ received: res.received, total: res.total });
    },
    [collector, onResult],
  );

  const scanner = useQrScanner(videoRef, !done, handleText);
  const problem = PROBLEM_KEY[scanner.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-box relative aspect-square w-full overflow-hidden bg-black">
        <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />
        {scanner.status === 'scanning' && (
          <div className="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-white/70" />
        )}
        {scanner.status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
            <Spinner size="md" />
            {t('qr.starting')}
          </div>
        )}
        {problem && (
          <div className="bg-base-200 text-base-content/70 absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
            <VideoOff className="size-8 opacity-60" />
            {t(problem, { detail: scanner.detail })}
          </div>
        )}
        {scanner.status === 'scanning' && (scanner.canSwitch || scanner.torchSupported) && (
          <div className="absolute right-3 bottom-3 flex gap-2">
            {scanner.torchSupported && (
              <button
                type="button"
                className="btn btn-circle btn-sm border-0 bg-black/55 text-white"
                onClick={scanner.toggleTorch}
                aria-label={t('qr.torch')}
                aria-pressed={scanner.torchOn}
                title={t('qr.torch')}
              >
                {scanner.torchOn ? <FlashlightOff className="size-4" /> : <Flashlight className="size-4" />}
              </button>
            )}
            {scanner.canSwitch && (
              <button
                type="button"
                className="btn btn-circle btn-sm border-0 bg-black/55 text-white"
                onClick={scanner.switchCamera}
                aria-label={t('qr.switchCamera')}
                title={t('qr.switchCamera')}
              >
                <SwitchCamera className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {progress && (
        <div>
          <progress className="progress progress-primary w-full" value={progress.received} max={progress.total} />
          <p className="text-base-content/60 tabular mt-1 text-center text-xs">{t('qr.progress', { ...progress })}</p>
        </div>
      )}
      <ScannerManualInput onSubmit={handleText} />
    </div>
  );
};
