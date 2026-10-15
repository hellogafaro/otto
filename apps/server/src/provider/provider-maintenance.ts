export {
  type ProviderMaintenanceCapabilities,
  type ProviderMaintenanceCommandAction,
  type ProviderMaintenanceCapabilityResolutionOptions,
  type ProviderMaintenanceCapabilitiesResolver,
  type PackageManagedProviderMaintenanceDefinition,
  providerMaintenanceCapabilities,
  manualOnlyProviderMaintenanceCapabilities,
  hasPathSeparator,
  normalizeCommandPath,
  resolvePackageManagedProviderMaintenance,
  packageManagedProviderMaintenanceResolver,
  staticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "./maintenance/provider-maintenance-capabilities.ts";

export {
  type ProviderVersionCacheEntry,
  ProviderVersionCache,
  createProviderVersionAdvisory,
  resolveLatestProviderVersion,
  enrichProviderSnapshotWithVersionAdvisory,
} from "./maintenance/provider-version-advisory.ts";
