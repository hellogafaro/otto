import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAccountGate } from "../components/auth/organization-account-gate";

export const Route = createFileRoute("/invite/$invitationId")({ component: InvitationPage });

function InvitationPage() {
  const { invitationId } = Route.useParams();

  return <OrganizationAccountGate page="invite" invitationId={invitationId} />;
}
