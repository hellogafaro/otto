import { createFileRoute } from "@tanstack/react-router";

import { CustomizeDetailPage } from "../components/customize/customize-detail";

export const Route = createFileRoute("/settings/skills/$id")({
  component: () => <CustomizeDetailPage type="skill" id={Route.useParams().id} />,
});
