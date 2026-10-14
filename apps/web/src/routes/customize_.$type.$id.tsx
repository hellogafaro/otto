import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { CustomizeDetailPage } from "../components/customize/CustomizeDetail";
import { isCustomizeEntityType } from "../components/customize/customize.logic";

export const Route = createFileRoute("/customize_/$type/$id")({
  beforeLoad: async ({ context, params }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }

    if (!isCustomizeEntityType(params.type)) throw notFound();
  },
  component: function CustomizeDetailRoute() {
    const { type, id } = Route.useParams();

    return isCustomizeEntityType(type) ? <CustomizeDetailPage type={type} id={id} /> : null;
  },
});
