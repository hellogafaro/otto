import { createFileRoute } from "@tanstack/react-router";
import { OrganizationAccountGate } from "../components/auth/OrganizationAccountGate";

export const Route = createFileRoute("/login")({
  component: () => <OrganizationAccountGate page="login" />,
});
