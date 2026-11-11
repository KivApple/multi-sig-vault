import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";

export interface PickerOption {
	value: string;
	title: string;
	subtitle?: string;
	icon?: ReactNode;
	/** Right aligned text (balance, price). */
	aside?: ReactNode;
	disabled?: boolean;
}

export interface PickerSelectProps {
	value: string | undefined;
	options: PickerOption[];
	onChange: (value: string) => void;
	/** Dialog title, also the accessible name of the trigger. */
	title: string;
	placeholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	/** Custom trigger content for the selected option. */
	renderValue?: (option: PickerOption) => ReactNode;
}

const SEARCH_FROM = 8;

/**
 * Rich drop-down: the trigger looks like a select, the list opens as a sheet (phones) or a dialog
 * with icons, two-line rows and search for long lists.
 */
export const PickerSelect: React.FC<PickerSelectProps> = ({
	value,
	options,
	onChange,
	title,
	placeholder,
	disabled,
	invalid,
	renderValue,
}) => {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter((o) => o.title.toLowerCase().includes(q) || o.subtitle?.toLowerCase().includes(q));
	}, [options, query]);

	const handleOpen = useCallback(() => {
		setQuery("");
		setOpen(true);
	}, []);
	const handleClose = useCallback(() => setOpen(false), []);
	const handlePick = useCallback(
		(v: string) => {
			setOpen(false);
			onChange(v);
		},
		[onChange],
	);

	return (
		<>
			<button
				type="button"
				className={`input flex h-auto min-h-12 w-full items-center gap-2 py-1.5 text-left ${invalid ? "input-error" : ""}`}
				onClick={handleOpen}
				disabled={disabled}
				aria-haspopup="dialog"
				aria-label={title}
			>
				<span className="flex min-w-0 flex-1 items-center gap-2">
					{selected ? (
						(renderValue?.(selected) ?? (
							<>
								{selected.icon}
								<span className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-medium">{selected.title}</span>
									{selected.subtitle && (
										<span className="text-base-content/60 truncate text-xs">{selected.subtitle}</span>
									)}
								</span>
							</>
						))
					) : (
						<span className="text-base-content/50">{placeholder ?? title}</span>
					)}
				</span>
				<ChevronDown className="text-base-content/50 size-4 shrink-0" />
			</button>
			<Dialog open={open} onClose={handleClose} title={title}>
				{options.length >= SEARCH_FROM && (
					<label className="input mb-2 flex w-full items-center gap-2">
						<Search className="text-base-content/50 size-4" />
						<input
							type="search"
							className="grow"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={t("common.search")}
							autoComplete="off"
						/>
					</label>
				)}
				<ul className="-mx-2 flex flex-col">
					{visible.map((o) => (
						<li key={o.value}>
							<button
								type="button"
								className="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left disabled:opacity-40"
								onClick={() => handlePick(o.value)}
								disabled={o.disabled}
							>
								{o.icon}
								<span className="flex min-w-0 flex-1 flex-col leading-tight">
									<span className="truncate font-medium">{o.title}</span>
									{o.subtitle && <span className="text-base-content/60 truncate text-xs">{o.subtitle}</span>}
								</span>
								{o.aside && <span className="text-base-content/70 tabular shrink-0 text-sm">{o.aside}</span>}
								{o.value === value && <Check className="text-primary size-4 shrink-0" />}
							</button>
						</li>
					))}
					{visible.length === 0 && (
						<li className="text-base-content/60 px-2 py-6 text-center text-sm">{t("common.nothingFound")}</li>
					)}
				</ul>
			</Dialog>
		</>
	);
};
