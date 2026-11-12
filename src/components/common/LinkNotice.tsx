import { useSearchParams } from "react-router";
import { useT } from "@/i18n";
import { LINK_PARAM, LINK_VALUE } from "@/lib/deepLink";
import { Notice } from "./Notice";

/** Warns that the form on this page was filled from a link, not by the user. */
export const LinkNotice: React.FC = () => {
	const t = useT();
	const [params] = useSearchParams();
	if (params.get(LINK_PARAM) !== LINK_VALUE) return null;
	return (
		<Notice tone="warning" className="mb-4">
			{t("link.notice")}
		</Notice>
	);
};
