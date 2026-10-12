import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAccountGate } from "../components/auth/OrganizationAccountGate";

export const Route = createFileRoute("/reset-password")({
  component: () => <OrganizationAccountGate page="reset" />,
});
