import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAccountGate } from "../components/auth/organization-account-gate";

export const Route = createFileRoute("/reset-password")({
  component: () => <OrganizationAccountGate page="reset" />,
});
