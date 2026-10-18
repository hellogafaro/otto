import { createFileRoute } from "@tanstack/react-router";

import { SharedFilePage } from "../components/library/shared-file-page";

export const Route = createFileRoute("/s/$shareId")({ component: SharedFileRoute });

function SharedFileRoute() {
  const { shareId } = Route.useParams();

  return <SharedFilePage shareId={shareId} />;
}
