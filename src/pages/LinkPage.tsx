import { Link2Off } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { seedDraft } from "@/components/createSafe/useDraft";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useT } from "@/i18n";
import { parseDeepLink } from "@/lib/deepLink";
import { randomSaltNonce } from "@/lib/safe/deploy";
import { useAppStore } from "@/store/appStore";

/** Entry point of deep links (`#/link?action=…`): checks the link and opens the pre-filled form. */
export const LinkPage: React.FC = () => {
	const t = useT();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const enabled = useAppStore((s) => s.settings.deepLinks);
	const target = useMemo(() => parseDeepLink(params), [params]);

	useEffect(() => {
		if (!enabled || !target) return;
		if (target.draft) seedDraft(target.draft, () => randomSaltNonce().toString());
		navigate(target.to, { replace: true });
	}, [enabled, target, navigate]);

	if (enabled && target) return null;
	return (
		<>
			<PageHeader title={t("link.title")} back="/" />
			<EmptyState
				icon={<Link2Off className="size-8" />}
				title={t(enabled ? "link.bad.title" : "link.off.title")}
				text={t(enabled ? "link.bad.text" : "link.off.text")}
				action={
					!enabled && (
						<Link className="btn btn-primary btn-sm" to="/settings">
							{t("nav.settings")}
						</Link>
					)
				}
			/>
		</>
	);
};
