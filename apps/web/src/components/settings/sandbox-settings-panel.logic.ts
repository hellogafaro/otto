import type { MessageKey } from "@otto/client-runtime/i18n";
import type {
  ProviderInstanceEnvironmentVariable,
  SandboxProvider,
  SandboxSettings,
} from "@otto/contracts";

export type CloudSandboxProvider = Exclude<SandboxProvider, "local">;

export interface SandboxCredentialField {
  readonly name: string;
  readonly label: MessageKey;
  readonly secret: boolean;
}

export interface SandboxProviderDefinition {
  readonly id: CloudSandboxProvider;
  readonly label: string;
  readonly description: MessageKey;
  readonly fields: ReadonlyArray<SandboxCredentialField>;
}

const SANDBOX_PROVIDER_DEFINITION_BY_ID: Readonly<
  Record<CloudSandboxProvider, SandboxProviderDefinition>
> = {
  boat: {
    id: "boat",
    label: "Boat",
    description: "Persistent Linux VMs managed by Boat. Requires an API key.",
    fields: [{ name: "BOAT_API_KEY", label: "API key", secret: true }],
  },
};

export const SANDBOX_PROVIDER_DEFINITIONS = Object.values(SANDBOX_PROVIDER_DEFINITION_BY_ID);

export function sandboxProviderDefinition(provider: CloudSandboxProvider) {
  return SANDBOX_PROVIDER_DEFINITION_BY_ID[provider];
}

export function isSandboxProviderConnected(
  settings: SandboxSettings,
  provider: CloudSandboxProvider,
): boolean {
  const environment = settings.providers[provider].environment;

  return sandboxProviderDefinition(provider).fields.every((field) => {
    const variable = environment.find((candidate) => candidate.name === field.name);

    return Boolean(variable && (variable.value.trim().length > 0 || variable.valueRedacted));
  });
}

export function selectableSandboxProviders(
  settings: SandboxSettings,
  boatConnectedByServer = false,
) {
  return [
    "local" as const,
    ...SANDBOX_PROVIDER_DEFINITIONS.flatMap((definition) =>
      isSandboxProviderConnected(settings, definition.id) ||
      (definition.id === "boat" && boatConnectedByServer)
        ? [definition.id]
        : [],
    ),
  ];
}

export function sandboxConnectionDraft(
  settings: SandboxSettings,
  provider: CloudSandboxProvider,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    sandboxProviderDefinition(provider).fields.map((field) => [
      field.name,
      settings.providers[provider].environment.find((variable) => variable.name === field.name)
        ?.value ?? "",
    ]),
  );
}

export function canSaveSandboxProviderConnection(input: {
  readonly settings: SandboxSettings;
  readonly provider: CloudSandboxProvider;
  readonly draft: Readonly<Record<string, string>>;
}): boolean {
  const existing = input.settings.providers[input.provider].environment;

  return sandboxProviderDefinition(input.provider).fields.every((field) => {
    if ((input.draft[field.name] ?? "").trim().length > 0) return true;
    const variable = existing.find((candidate) => candidate.name === field.name);

    return field.secret && variable?.valueRedacted === true;
  });
}

export function saveSandboxProviderConnection(input: {
  readonly settings: SandboxSettings;
  readonly provider: CloudSandboxProvider;
  readonly draft: Readonly<Record<string, string>>;
}): SandboxSettings {
  const currentEnvironment = input.settings.providers[input.provider].environment;

  const environment = sandboxProviderDefinition(input.provider).fields.map((field) => {
    const value = (input.draft[field.name] ?? "").trim();
    const current = currentEnvironment.find((variable) => variable.name === field.name);

    if (field.secret && value.length === 0 && current?.valueRedacted) return current;

    return {
      name: field.name,
      value,
      sensitive: field.secret,
    } satisfies ProviderInstanceEnvironmentVariable;
  });

  return {
    ...input.settings,
    providers: {
      ...input.settings.providers,
      [input.provider]: { environment },
    },
  };
}

export function disconnectSandboxProvider(
  settings: SandboxSettings,
  provider: CloudSandboxProvider,
): SandboxSettings {
  return {
    ...settings,
    defaultProvider: settings.defaultProvider === provider ? "local" : settings.defaultProvider,
    providers: { ...settings.providers, [provider]: { environment: [] } },
  };
}
