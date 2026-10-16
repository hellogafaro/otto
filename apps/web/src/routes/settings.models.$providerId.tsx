import { createFileRoute, redirect } from "@tanstack/react-router";

// Otto: Providers have no page of their own any more; old links land on Models.
export const Route = createFileRoute("/settings/models/$providerId")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/$section", params: { section: "models" }, replace: true });
  },
});
