import { ExternalLink } from "lucide-react";
import { useCallback } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import { useHandoffStore } from "@/lib/handoff/client";

/**
 * Shown while a request waits to be confirmed in MetaMask's own browser. The link is a real anchor the
 * user taps: Android opens another app only from a tap.
 */
export const HandoffDialog: React.FC = () => {
	const t = useT();
	const pending = useHandoffStore((s) => s.pending);
	const handleClose = useCallback(() => useHandoffStore.getState().pending?.cancel(), []);

	return (
		<Dialog open={!!pending} onClose={handleClose} title={t("handoff.title")} size="sm">
			{pending && (
				<div className="flex flex-col gap-4">
					<p className="text-base-content/70 text-sm">{t("handoff.text")}</p>
					<div className="bg-base-200 rounded-box px-4 py-3 text-center">
						<div className="field-label mb-0">{t("handoff.code")}</div>
						<div className="mono tabular text-2xl font-semibold tracking-widest">{pending.code}</div>
					</div>
					<a className="btn btn-primary" href={pending.href} target="_blank" rel="noopener noreferrer">
						<ExternalLink className="size-4" />
						{t("handoff.open")}
					</a>
					<div className="text-base-content/60 flex items-center justify-center gap-2 text-sm">
						<Spinner size="xs" />
						{t("handoff.waiting")}
					</div>
				</div>
			)}
		</Dialog>
	);
};
