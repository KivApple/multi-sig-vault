import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initDataCache } from "./lib/dataCache";
import { guardEntry } from "./lib/deepLink";
import { initTokens } from "./lib/tokens";
import { initUpdates } from "./lib/update";
import { initAppStore, useAppStore } from "./store/appStore";
import "./styles.css";

/**
 * Shown when the stored data cannot be read for a while. The usual cause on a phone: the app is also
 * open in another tab that the system froze in the middle of saving, and its unfinished write holds the
 * storage. Starting with empty data instead would overwrite the real data on the next save, so the app
 * waits – but says why.
 */
const showWaiting = (root: HTMLElement): void => {
	const ru = /^ru\b/i.test(navigator.language);
	const box = document.createElement("div");
	box.className = "mx-auto max-w-sm px-6 pt-24 text-center";
	const title = document.createElement("p");
	title.className = "text-lg font-semibold";
	title.textContent = ru ? "Ждём доступа к данным" : "Waiting for the stored data";
	const text = document.createElement("p");
	text.className = "text-base-content/70 mt-2 text-sm";
	text.textContent = ru
		? "Данные заняты другой вкладкой или окном этого приложения, которое сейчас неактивно. Откройте его или закройте — приложение запустится само."
		: "Another tab or window of this app, inactive right now, is holding the data. Open it or close it, and the app will start by itself.";
	box.append(title, text);
	root.replaceChildren(box);
};

const start = async (): Promise<void> => {
	const root = document.getElementById("root") as HTMLElement;
	const waiting = setTimeout(() => showWaiting(root), 3000);
	await Promise.all([initAppStore(), initDataCache()]);
	clearTimeout(waiting);
	root.replaceChildren();
	guardEntry(useAppStore.getState().settings.deepLinks);
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
	void initTokens();
	void initUpdates();
};

void start();
