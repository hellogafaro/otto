import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

// Otto: servers moved under Settings > Integrations and skills under Settings > Skills.
export const Route = createFileRoute("/customize_/$type/$id")({
  beforeLoad: ({ params }) => {
    if (params.type === "mcp") {
      throw redirect({
        to: "/settings/integrations/mcp/$id",
        params: { id: params.id },
        replace: true,
      });
    }

    if (params.type === "skill") {
      throw redirect({ to: "/settings/skills/$id", params: { id: params.id }, replace: true });
    }

    throw notFound();
  },
});
