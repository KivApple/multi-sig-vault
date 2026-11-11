import { ClipboardPaste } from "lucide-react";
import { useCallback, useState, type ChangeEvent } from "react";
import { Field } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";

export interface ScannerManualInputProps {
	onSubmit: (text: string) => void;
}

/** Scanner fallback for devices without a camera: paste the code or address as text. */
export const ScannerManualInput: React.FC<ScannerManualInputProps> = ({ onSubmit }) => {
	const t = useT();
	const [value, setValue] = useState("");

	const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value), []);
	const handleSubmit = useCallback(() => onSubmit(value), [onSubmit, value]);
	const handlePaste = useCallback(async () => {
		try {
			const text = (await navigator.clipboard.readText()).trim();
			if (text) onSubmit(text);
		} catch {
			toast.info(t("qr.pasteFailed"));
		}
	}, [onSubmit, t]);

	return (
		<Field label={t("qr.manual")}>
			<textarea
				className="textarea mono w-full text-sm"
				rows={2}
				value={value}
				onChange={handleChange}
				placeholder={t("qr.manualPlaceholder")}
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
			/>
			<div className="mt-2 flex gap-2">
				<button type="button" className="btn btn-sm flex-1" onClick={() => void handlePaste()}>
					<ClipboardPaste className="size-4" />
					{t("qr.pasteClipboard")}
				</button>
				{value.trim() && (
					<button type="button" className="btn btn-primary btn-sm flex-1" onClick={handleSubmit}>
						{t("qr.submit")}
					</button>
				)}
			</div>
		</Field>
	);
};
