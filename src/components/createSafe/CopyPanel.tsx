import { Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isHash, type Hex } from "viem";
import { PickerSelect, type PickerOption } from "@/components/common/PickerSelect";
import { TextField } from "@/components/common/TextField";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { Field } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { shortAddress } from "@/lib/format";
import { fetchCreationFromTx, resolveCreation } from "@/lib/safe/creation";
import type { Account, SafeCreation } from "@/types/domain";

export interface CopyPanelProps {
	/** Safes of the app that can be reproduced on the target chain. */
	sources: Account[];
	sourceId: string | undefined;
	/** Creation parameters already resolved for `sourceId`. */
	creation: SafeCreation | undefined;
	onSource: (id: string) => void;
	onResolved: (creation: SafeCreation | undefined) => void;
	disabled?: boolean;
}

type Lookup = { status: "idle" | "loading" | "needTx" } | { status: "error"; message: string };

/**
 * Mode "same address as an existing Safe": finds how the source Safe was created (stored parameters,
 * Safe Transaction Service, or its creation transaction) so the same deployment can be repeated.
 */
export const CopyPanel: React.FC<CopyPanelProps> = ({ sources, sourceId, creation, onSource, onResolved, disabled }) => {
	const t = useT();
	const source = useMemo(() => sources.find((a) => a.id === sourceId), [sources, sourceId]);
	const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
	const [txHash, setTxHash] = useState("");
	const [searching, setSearching] = useState(false);

	const options = useMemo<PickerOption[]>(
		() =>
			sources.map((a) => ({
				value: a.id,
				title: a.name?.trim() || shortAddress(a.address),
				subtitle: `${getChain(a.chainId as number).name} · ${shortAddress(a.address)}`,
				icon: <AccountIcon kind="safe" env={a.env} chainId={a.chainId} size={32} />,
			})),
		[sources],
	);

	useEffect(() => {
		if (!source || creation) {
			setLookup({ status: "idle" });
			return undefined;
		}
		let cancelled = false;
		setLookup({ status: "loading" });
		void resolveCreation(source).then((found) => {
			if (cancelled) return;
			if (found) onResolved(found);
			else setLookup({ status: "needTx" });
		});
		return () => {
			cancelled = true;
		};
	}, [source, creation, onResolved]);

	const handleSearch = useCallback(async () => {
		if (!source || !isHash(txHash.trim())) return;
		setSearching(true);
		try {
			onResolved(await fetchCreationFromTx(source.chainId as number, txHash.trim() as Hex, source.address));
		} catch (e) {
			setLookup({ status: "error", message: describeError(e, t) });
		} finally {
			setSearching(false);
		}
	}, [source, txHash, onResolved, t]);

	if (sources.length === 0) {
		return <p className="text-base-content/70 text-sm">{t("createSafe.copy.noSources")}</p>;
	}

	const askTx = lookup.status === "needTx" || lookup.status === "error";
	return (
		<div className="flex flex-col gap-3">
			<Field label={t("createSafe.copy.source")}>
				<PickerSelect
					value={sourceId}
					options={options}
					onChange={onSource}
					title={t("createSafe.copy.source")}
					placeholder={t("createSafe.copy.choose")}
					disabled={disabled}
				/>
			</Field>
			{lookup.status === "loading" && (
				<div className="text-base-content/70 flex items-center gap-2 text-sm" role="status">
					<Spinner size="xs" />
					{t("createSafe.copy.resolving")}
				</div>
			)}
			{askTx && source && (
				<>
					<TextField
						label={t("createSafe.copy.txHash")}
						value={txHash}
						onChange={setTxHash}
						mono
						placeholder="0x…"
						hint={t("createSafe.copy.txHashHint", { network: getChain(source.chainId as number).name })}
						error={lookup.status === "error" ? lookup.message : undefined}
						disabled={disabled}
					/>
					<button
						type="button"
						className="btn btn-outline btn-sm self-start"
						onClick={handleSearch}
						disabled={disabled || searching || !isHash(txHash.trim())}
					>
						{searching ? <Spinner size="xs" /> : <Search className="size-4" />}
						{t("createSafe.copy.find")}
					</button>
				</>
			)}
			{creation && (
				<p className="text-warning-content/90 bg-warning/15 rounded-box flex items-start gap-2 px-3 py-2 text-xs">
					<TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
					<span className="text-base-content">{t("createSafe.copy.initialOwners")}</span>
				</p>
			)}
		</div>
	);
};
