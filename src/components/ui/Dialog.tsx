import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import { useT } from "@/i18n";

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	children?: ReactNode;
	/** Buttons row pinned to the bottom. */
	actions?: ReactNode;
	size?: "sm" | "md" | "lg";
	/** `false` – Esc, back button and backdrop do not close (long running step). */
	dismissable?: boolean;
}

const WIDTH: Record<NonNullable<DialogProps["size"]>, string> = {
	sm: "sm:max-w-sm",
	md: "sm:max-w-md",
	lg: "sm:max-w-2xl",
};

/**
 * Native `<dialog>`: Esc and the Android back button close it for free (CloseWatcher),
 * focus is trapped by the browser. Bottom sheet on phones, centered on larger screens.
 */
export const Dialog: React.FC<DialogProps> = ({
	open,
	onClose,
	title,
	children,
	actions,
	size = "md",
	dismissable = true,
}) => {
	const ref = useRef<HTMLDialogElement>(null);
	const t = useT();

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	const handleCancel = useCallback(
		(e: SyntheticEvent) => {
			if (!dismissable) e.preventDefault();
		},
		[dismissable],
	);

	// A click closes the dialog only when the button went down and came up on the backdrop. A press
	// inside released outside (selecting text, a slipped drag), or the reverse, is not a wish to close –
	// and the browser reports both as a click on the dialog element itself.
	const press = useRef({ down: false, up: false });
	const handleDown = useCallback((e: MouseEvent<HTMLDialogElement>) => {
		press.current = { down: e.target === ref.current, up: false };
	}, []);
	const handleUp = useCallback((e: MouseEvent<HTMLDialogElement>) => {
		press.current.up = e.target === ref.current;
	}, []);
	const handleBackdrop = useCallback(
		(e: MouseEvent<HTMLDialogElement>) => {
			const { down, up } = press.current;
			press.current = { down: false, up: false };
			if (dismissable && down && up && e.target === ref.current) onClose();
		},
		[dismissable, onClose],
	);

	return (
		<dialog
			ref={ref}
			className="modal modal-bottom sm:modal-middle"
			onClose={onClose}
			onCancel={handleCancel}
			onMouseDown={handleDown}
			onMouseUp={handleUp}
			onClick={handleBackdrop}
		>
			{open && (
				<div className={`modal-box flex max-h-[92dvh] flex-col p-0 ${WIDTH[size]}`}>
					<div className="flex items-center gap-2 px-5 pt-4 pb-0.5">
						<h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
						{dismissable && (
							<button
								type="button"
								className="btn btn-ghost btn-sm btn-circle -mr-2"
								onClick={onClose}
								aria-label={t("common.close")}
							>
								<X className="size-5" />
							</button>
						)}
					</div>
					{/* The scrolling body clips whatever touches its edge: the top padding keeps the focus ring of a first field whole. */}
					<div className={`min-h-0 flex-1 overflow-y-auto px-5 pt-1.5 ${actions ? "pb-5" : "pb-safe"}`}>{children}</div>
					{actions && (
						<div className="border-base-300 pb-safe flex flex-wrap justify-end gap-2 border-t px-5 pt-3">{actions}</div>
					)}
				</div>
			)}
		</dialog>
	);
};
