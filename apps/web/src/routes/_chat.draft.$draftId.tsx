import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RemovedDraftRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/chats", replace: true });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: RemovedDraftRoute,
});
