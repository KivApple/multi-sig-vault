import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initDataCache } from "./lib/dataCache";
import { guardEntry } from "./lib/deepLink";
import { initTokens } from "./lib/tokens";
import { initUpdates } from "./lib/update";
import { initAppStore, useAppStore } from "./store/appStore";
import "./styles.css";

const start = async (): Promise<void> => {
	await Promise.all([initAppStore(), initDataCache()]);
	guardEntry(useAppStore.getState().settings.deepLinks);
	createRoot(document.getElementById("root") as HTMLElement).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
	void initTokens();
	void initUpdates();
};

void start();
