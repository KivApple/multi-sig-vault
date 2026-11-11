import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { errorText } from "@/lib/errors";

export type ScannerStatus = "starting" | "scanning" | "denied" | "no-camera" | "insecure" | "busy" | "error";

export interface UseQrScannerResult {
	status: ScannerStatus;
	/** Browser error text for `status === 'error'`. */
	detail: string;
	/** More than one camera is available. */
	canSwitch: boolean;
	switchCamera: () => void;
	torchSupported: boolean;
	torchOn: boolean;
	toggleTorch: () => void;
}

interface DetectedCode {
	rawValue: string;
}
interface BarcodeDetectorLike {
	detect: (source: CanvasImageSource) => Promise<DetectedCode[]>;
}
interface BarcodeDetectorCtor {
	new (options: { formats: string[] }): BarcodeDetectorLike;
	getSupportedFormats?: () => Promise<string[]>;
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

/** Time between decode attempts – keeps the UI thread free and the battery cool. */
const SCAN_INTERVAL_MS = 120;
/** Longest side of the frame handed to the JS decoder. */
const FALLBACK_MAX_SIDE = 960;

const createDecoder = async (): Promise<Decoder> => {
	const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
	if (Native) {
		try {
			const formats = (await Native.getSupportedFormats?.()) ?? ["qr_code"];
			if (formats.includes("qr_code")) {
				const detector = new Native({ formats: ["qr_code"] });
				return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
			}
		} catch {
			// Fall through to the JS decoder.
		}
	}
	const { default: jsQR } = await import("jsqr");
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	return async (video) => {
		if (!ctx) return null;
		const scale = Math.min(1, FALLBACK_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
		const w = Math.round(video.videoWidth * scale);
		const h = Math.round(video.videoHeight * scale);
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		ctx.drawImage(video, 0, 0, w, h);
		const image = ctx.getImageData(0, 0, w, h);
		return jsQR(image.data, w, h, { inversionAttempts: "dontInvert" })?.data || null;
	};
};

const classify = (e: unknown): ScannerStatus => {
	const name = e instanceof DOMException ? e.name : "";
	if (name === "NotAllowedError" || name === "SecurityError") return "denied";
	if (name === "NotFoundError" || name === "OverconstrainedError") return "no-camera";
	if (name === "NotReadableError" || name === "AbortError") return "busy";
	return "error";
};

interface TorchCapabilities extends MediaTrackCapabilities {
	torch?: boolean;
}

/**
 * Runs the camera into `videoRef` and reports every decoded QR text to `onDecode`.
 * Safe under StrictMode: a start that finishes after cleanup releases its stream immediately.
 */
export const useQrScanner = (
	videoRef: RefObject<HTMLVideoElement | null>,
	active: boolean,
	onDecode: (text: string) => void,
): UseQrScannerResult => {
	const [status, setStatus] = useState<ScannerStatus>("starting");
	const [detail, setDetail] = useState("");
	const [cameras, setCameras] = useState<string[]>([]);
	const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
	const [torchSupported, setTorchSupported] = useState(false);
	const [torchOn, setTorchOn] = useState(false);
	const trackRef = useRef<MediaStreamTrack | null>(null);
	const onDecodeRef = useRef(onDecode);
	onDecodeRef.current = onDecode;

	useEffect(() => {
		if (!active) return undefined;
		let cancelled = false;
		let stream: MediaStream | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const stop = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			stream?.getTracks().forEach((track) => track.stop());
			stream = undefined;
			trackRef.current = null;
		};

		const start = async (): Promise<void> => {
			setStatus("starting");
			setTorchOn(false);
			setTorchSupported(false);
			if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
				setStatus("insecure");
				return;
			}
			try {
				const media = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: deviceId
						? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
						: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
				});
				if (cancelled) {
					media.getTracks().forEach((track) => track.stop());
					return;
				}
				stream = media;
				const [track] = media.getVideoTracks();
				trackRef.current = track ?? null;
				setTorchSupported(!!(track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch);

				const video = videoRef.current;
				if (!video) return;
				video.srcObject = media;
				await video.play().catch(() => undefined);

				const [decode, devices] = await Promise.all([
					createDecoder(),
					navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]),
				]);
				if (cancelled) return;
				setCameras(devices.filter((d) => d.kind === "videoinput" && d.deviceId).map((d) => d.deviceId));
				setStatus("scanning");

				const loop = async (): Promise<void> => {
					if (cancelled) return;
					if (!document.hidden && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
						try {
							const text = await decode(video);
							if (text && !cancelled) onDecodeRef.current(text);
						} catch {
							// A failed frame is not an error – try the next one.
						}
					}
					if (!cancelled) timer = setTimeout(() => void loop(), SCAN_INTERVAL_MS);
				};
				void loop();
			} catch (e) {
				if (cancelled) return;
				setDetail(errorText(e));
				setStatus(classify(e));
			}
		};

		void start();
		return () => {
			cancelled = true;
			stop();
			const video = videoRef.current;
			if (video) video.srcObject = null;
		};
	}, [active, deviceId, videoRef]);

	const switchCamera = useCallback(() => {
		if (cameras.length < 2) return;
		const current = trackRef.current?.getSettings().deviceId ?? deviceId;
		const at = current ? cameras.indexOf(current) : -1;
		setDeviceId(cameras[(at + 1) % cameras.length]);
	}, [cameras, deviceId]);

	const toggleTorch = useCallback(() => {
		const track = trackRef.current;
		if (!track) return;
		const next = !torchOn;
		track
			.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
			.then(() => setTorchOn(next))
			.catch(() => setTorchSupported(false));
	}, [torchOn]);

	return {
		status,
		detail,
		canSwitch: cameras.length > 1,
		switchCamera,
		torchSupported,
		torchOn,
		toggleTorch,
	};
};
