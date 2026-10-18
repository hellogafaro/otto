import { RiHashtag, RiLink } from "@remixicon/react";
import { toast } from "sonner";

import { readPrimaryEnvironmentTarget } from "../environments/primary/target";
import { writeTextToClipboard } from "../hooks/use-copy-to-clipboard";
import { useI18n } from "../i18n";
import { MenuItem } from "./ui/menu";

/**
 * Otto: Copy link and Copy ID, the same pair in every page's More actions menu (task, project,
 * routine, Library item and chat). The link is the page's full address on the Otto server, so it
 * opens for anyone with access; a toast confirms each copy.
 */
export function CopyMenuItems({ path, id }: { readonly path: string; readonly id: string }) {
  const { t } = useI18n();

  const copy = (value: string, copied: string, failed: string) =>
    void writeTextToClipboard(value).then(
      () => toast.success(copied),
      () => toast.error(failed),
    );

  return (
    <>
      <MenuItem
        onClick={() =>
          copy(
            new URL(path, readPrimaryEnvironmentTarget().target.httpBaseUrl).toString(),
            t("Link has been copied"),
            t("Link couldn't be copied"),
          )
        }
      >
        <RiLink />
        {t("Copy link")}
      </MenuItem>
      <MenuItem onClick={() => copy(id, t("ID has been copied"), t("ID couldn't be copied"))}>
        <RiHashtag />
        {t("Copy ID")}
      </MenuItem>
    </>
  );
}
