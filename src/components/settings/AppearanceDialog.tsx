import { SettingsSection } from "@/components/ui/SettingsSection";
import { Dialog } from "@/components/ui/Dialog";
import { UpdateSettingsSection } from "@/components/update/UpdateSettingsSection";
import { useT } from "@/i18n";
import { AppearanceSettings } from "./AppearanceSettings";

export interface AppearanceDialogProps {
	open: boolean;
	onClose: () => void;
}

/**
 * The settings that matter on a page outside the app frame (the signing page in MetaMask's browser):
 * theme, language and updates of this copy of the app.
 */
export const AppearanceDialog: React.FC<AppearanceDialogProps> = ({ open, onClose }) => {
	const t = useT();
	return (
		<Dialog open={open} onClose={onClose} title={t("nav.settings")}>
			<SettingsSection title={t("settings.appearance")}>
				<AppearanceSettings />
			</SettingsSection>
			<UpdateSettingsSection />
		</Dialog>
	);
};
