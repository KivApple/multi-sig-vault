import { HashRouter, Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { Toaster } from "@/components/ui/Toaster";
import { useTheme } from "@/hooks/useTheme";
import { AccountPage } from "@/pages/AccountPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { AddAccountPage } from "@/pages/AddAccountPage";
import { CreateSafePage } from "@/pages/CreateSafePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SignersPage } from "@/pages/SignersPage";

export const App: React.FC = () => {
	useTheme();
	return (
		<ConfirmProvider>
			<HashRouter>
				<Routes>
					<Route element={<AppLayout />}>
						<Route index element={<AccountsPage />} />
						<Route path="accounts/new" element={<AddAccountPage />} />
						<Route path="accounts/create-safe" element={<CreateSafePage />} />
						<Route path="account/:id" element={<AccountPage />} />
						<Route path="signers" element={<SignersPage />} />
						<Route path="settings" element={<SettingsPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Route>
				</Routes>
			</HashRouter>
			<Toaster />
		</ConfirmProvider>
	);
};
