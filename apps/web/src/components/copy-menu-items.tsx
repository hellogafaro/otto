import { RiHashtag, RiLink } from "@remixicon/react";
import { useMemo } from "react";
import { toast } from "sonner";

import { readPrimaryEnvironmentTarget } from "../environments/primary/target";
import { writeTextToClipboard } from "../hooks/use-copy-to-clipboard";
import { useI18n } from "../i18n";
import type { PageAction } from "../page-actions-registry";
import { PageActionMenuItem } from "./page-action-menu-item";

/**
 * Otto: Copy link and Copy ID, the same pair on every page (task, project, routine, Library item
 * and chat). The link is the page's full address on the Otto server, so it opens for anyone with
 * access; a toast confirms each copy.
 */
export function useCopyPageActions(
  path: string,
  id: string,
): { readonly link: PageAction; readonly id: PageAction } {
  const { t } = useI18n();

  return useMemo(() => {
    const copy = (value: string, copied: string, failed: string) =>
      writeTextToClipboard(value).then(
        () => void toast.success(copied),
        () => void toast.error(failed),
      );

    return {
      link: {
        id: "copy-link",
        title: t("Copy link"),
        icon: RiLink,
        searchTerms: ["copy link", "url", "share"],
        shortcutCommand: "item.copyLink",
        run: () =>
          copy(
            new URL(path, readPrimaryEnvironmentTarget().target.httpBaseUrl).toString(),
            t("Link has been copied"),
            t("Link couldn't be copied"),
          ),
      },
      id: {
        id: "copy-id",
        title: t("Copy ID"),
        icon: RiHashtag,
        searchTerms: ["copy id", "identifier"],
        shortcutCommand: "item.copyId",
        run: () => copy(id, t("ID has been copied"), t("ID couldn't be copied")),
      },
    };
  }, [id, path, t]);
}

export function CopyMenuItems({
  actions,
}: {
  readonly actions: ReturnType<typeof useCopyPageActions>;
}) {
  return (
    <>
      <PageActionMenuItem action={actions.link} />
      <PageActionMenuItem action={actions.id} />
    </>
  );
}
