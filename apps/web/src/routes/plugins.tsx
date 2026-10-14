import { createFileRoute, redirect } from "@tanstack/react-router";

/** Plugins became Customize; old links land on its Apps tab. */
export const Route = createFileRoute("/plugins")({
  beforeLoad: () => {
    throw redirect({ to: "/customize", replace: true });
  },
});
