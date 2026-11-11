import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/i18n";
import { Dialog } from "./Dialog";

export interface ConfirmOptions {
	title: string;
	body?: ReactNode;
	confirmLabel?: string;
	danger?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export interface ConfirmProviderProps {
	children: ReactNode;
}

/** One shared confirmation dialog; `useConfirm()` returns a promise based `confirm()`. */
export const ConfirmProvider: React.FC<ConfirmProviderProps> = ({ children }) => {
	const t = useT();
	const [options, setOptions] = useState<ConfirmOptions | null>(null);
	const resolver = useRef<((ok: boolean) => void) | null>(null);

	const confirm = useCallback<ConfirmFn>(
		(opts) =>
			new Promise<boolean>((resolve) => {
				resolver.current?.(false);
				resolver.current = resolve;
				setOptions(opts);
			}),
		[],
	);

	const settle = useCallback((ok: boolean) => {
		resolver.current?.(ok);
		resolver.current = null;
		setOptions(null);
	}, []);

	const handleClose = useCallback(() => settle(false), [settle]);
	const handleConfirm = useCallback(() => settle(true), [settle]);

	const actions = useMemo(
		() => (
			<>
				<button type="button" className="btn btn-ghost" onClick={handleClose}>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					className={`btn ${options?.danger ? "btn-error" : "btn-primary"}`}
					onClick={handleConfirm}
				>
					{options?.confirmLabel ?? t("common.confirm")}
				</button>
			</>
		),
		[handleClose, handleConfirm, options, t],
	);

	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			<Dialog open={!!options} onClose={handleClose} title={options?.title} actions={actions} size="sm">
				{options?.body && <div className="text-base-content/80 text-sm">{options.body}</div>}
			</Dialog>
		</ConfirmContext.Provider>
	);
};
