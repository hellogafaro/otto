import { createFileRoute } from "@tanstack/react-router";

import { CustomizeDetailPage } from "../components/customize/CustomizeDetail";

export const Route = createFileRoute("/settings/integrations/mcp/$id")({
  component: () => <CustomizeDetailPage type="mcp" id={Route.useParams().id} />,
});
