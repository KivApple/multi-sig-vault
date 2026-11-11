import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
	id: number;
	kind: ToastKind;
	text: string;
}

interface ToastState {
	items: ToastItem[];
	push: (kind: ToastKind, text: string) => void;
	dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
	items: [],
	push: (kind, text) => {
		const id = nextId++;
		set((s) => ({ items: [...s.items.slice(-2), { id, kind, text }] }));
		setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 3000);
	},
	dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
	success: (text: string): void => useToastStore.getState().push("success", text),
	error: (text: string): void => useToastStore.getState().push("error", text),
	info: (text: string): void => useToastStore.getState().push("info", text),
};
