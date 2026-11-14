import type { Account } from "@/types/domain";

/** One card of the home screen: an account, or the Safes of one address on several networks. */
export interface AccountItem {
	/** The account id, or `group:<env>:<address>` for a group. */
	id: string;
	/** More than one – a group; in the order of its rows. */
	accounts: Account[];
}

const groupId = (account: Account): string => `group:${account.env}:${account.address.toLowerCase()}`;

/**
 * The accounts as cards, in list order. With `grouping`, Safes that share an address within one
 * environment (mainnet and testnet never mix) become one item, placed where its first Safe is.
 * Groups are not stored: they follow from the list.
 */
export const groupAccounts = (accounts: Account[], grouping: boolean): AccountItem[] => {
	if (!grouping) return accounts.map((a) => ({ id: a.id, accounts: [a] }));
	const groups = new Map<string, Account[]>();
	for (const a of accounts) {
		if (a.kind !== "safe") continue;
		const members = groups.get(groupId(a));
		if (members) members.push(a);
		else groups.set(groupId(a), [a]);
	}
	const items: AccountItem[] = [];
	const placed = new Set<string>();
	for (const a of accounts) {
		const members = a.kind === "safe" ? groups.get(groupId(a)) : undefined;
		if (!members || members.length < 2) items.push({ id: a.id, accounts: [a] });
		else if (!placed.has(groupId(a))) {
			placed.add(groupId(a));
			items.push({ id: groupId(a), accounts: members });
		}
	}
	return items;
};

/**
 * Account ids in list order after a drag: `itemOrder` – the cards in their new order,
 * `rows` – the new order of the rows inside one group. The Safes of a group end up next to each other.
 */
export const flattenItems = (
	items: AccountItem[],
	itemOrder?: string[],
	rows?: { groupId: string; ids: string[] },
): string[] => {
	const byId = new Map(items.map((item) => [item.id, item]));
	const ordered = itemOrder
		? [
				...itemOrder.map((id) => byId.get(id)).filter((item): item is AccountItem => !!item),
				...items.filter((item) => !itemOrder.includes(item.id)),
			]
		: items;
	return ordered.flatMap((item) => {
		const ids = item.accounts.map((a) => a.id);
		if (rows?.groupId !== item.id) return ids;
		return [...rows.ids.filter((id) => ids.includes(id)), ...ids.filter((id) => !rows.ids.includes(id))];
	});
};
