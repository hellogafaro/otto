import { createFileRoute, redirect } from "@tanstack/react-router";

import { providerCatalogEntry } from "../components/settings/provider-catalog";
import { ProviderDetailPage } from "../components/settings/provider-detail-page";

export const Route = createFileRoute("/settings/models/$providerId")({
  beforeLoad: ({ params }) => {
    if (providerCatalogEntry(params.providerId)) return;
    throw redirect({ to: "/settings/$section", params: { section: "models" }, replace: true });
  },
  component: ProviderSettingsRoute,
});

function ProviderSettingsRoute() {
  const { providerId } = Route.useParams();
  const entry = providerCatalogEntry(providerId);

  if (!entry) return null;

  return <ProviderDetailPage key={entry.slug} entry={entry} />;
}
