import { RiPuzzleLine, RiSparkling2Line } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@otto/contracts";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { DetailsTabs } from "../DetailsAside";
import { WorkspacePageContainer, WorkspacePageTitle } from "../WorkspacePageContainer";
import { WorkPage } from "../work/WorkPages";
import { CustomizeIntegrations } from "./CustomizeIntegrations";
import { CustomizeSkills } from "./CustomizeSkills";
import type { CustomizeTab } from "./customize.logic";

function CustomizeTabBody({
  tab,
  environmentId,
}: {
  readonly tab: CustomizeTab;
  readonly environmentId: EnvironmentId;
}) {
  switch (tab) {
    case "integrations":
      return <CustomizeIntegrations environmentId={environmentId} />;
    case "skills":
      return <CustomizeSkills environmentId={environmentId} />;
  }
}

/**
 * Otto: Customize gathers what bots can use: Integrations (Composio apps and remote MCP servers,
 * both tools reached over MCP) and Skills, one tab open at a time (`?tab=`), on the `content`
 * column with the 32px page tabs 20px under the title. Each tab shows a Yours and a Workspace
 * group card, and each card's plus adds to that group.
 */
export function CustomizePage({ tab }: { readonly tab: CustomizeTab }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();

  return (
    <WorkPage>
      <WorkspacePageContainer className="flex-1 gap-6 pt-3 pb-16 sm:pt-4">
        <div className="flex flex-col gap-3">
          <WorkspacePageTitle>{t("Customize")}</WorkspacePageTitle>
          <div className="mt-2 mb-2">
            <DetailsTabs<CustomizeTab>
              label={t("Customize sections")}
              size="page"
              tabs={[
                { value: "integrations", label: t("Integrations"), icon: RiPuzzleLine },
                { value: "skills", label: t("Skills"), icon: RiSparkling2Line },
              ]}
              value={tab}
              onValueChange={(next) =>
                void navigate({
                  to: "/customize",
                  search: next === "integrations" ? {} : { tab: next },
                })
              }
            />
          </div>
        </div>
        {environmentId ? (
          <CustomizeTabBody tab={tab} environmentId={environmentId} />
        ) : (
          <p className="px-4 text-13px text-muted-foreground">
            {t("Connect an environment to customize your bots.")}
          </p>
        )}
      </WorkspacePageContainer>
    </WorkPage>
  );
}
