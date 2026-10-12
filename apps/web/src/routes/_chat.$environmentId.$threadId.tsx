import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RemovedThreadRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: RemovedThreadRoute,
});
