import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";
import { AppearanceSettings } from "./AppearanceSettings";

export interface AppearanceDialogProps {
	open: boolean;
	onClose: () => void;
}

/** Theme and language for pages that live outside the app frame (the signing page in MetaMask's browser). */
export const AppearanceDialog: React.FC<AppearanceDialogProps> = ({ open, onClose }) => {
	const t = useT();
	return (
		<Dialog open={open} onClose={onClose} title={t("settings.appearance")} size="sm">
			<div className="divide-base-300 -mx-4 flex flex-col divide-y">
				<AppearanceSettings />
			</div>
		</Dialog>
	);
};
