const DEFAULT_DOCUMENTATION_URL = "https://github.com/hellogafaro/otto/blob/main/";

function resolveDocumentationUrl(override: string | undefined): URL {
  try {
    const url = new URL(override?.trim() || DEFAULT_DOCUMENTATION_URL);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return new URL(DEFAULT_DOCUMENTATION_URL);
    }

    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;

    return url;
  } catch {
    return new URL(DEFAULT_DOCUMENTATION_URL);
  }
}

const DOCUMENTATION_URL = resolveDocumentationUrl(process.env.EXPO_PUBLIC_DOCUMENTATION_URL);

function documentationUrl(path: string): string {
  return new URL(path, DOCUMENTATION_URL).toString();
}

export const PRIVACY_POLICY_URL = documentationUrl("docs/user/privacy.md");

export const SOFTWARE_LICENSE_URL = documentationUrl("LICENSE");

export const LEGAL_URL = documentationUrl("THIRD_PARTY_NOTICES.md");

export const ALLOWED_LEGAL_DOCUMENT_URLS = [
  LEGAL_URL,
  PRIVACY_POLICY_URL,
  SOFTWARE_LICENSE_URL,
] as const;

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

const ALLOWED_LEGAL_DOCUMENT_IDENTITIES = new Set(
  ALLOWED_LEGAL_DOCUMENT_URLS.flatMap((url) => {
    const value = webDocumentIdentity(url);

    return value === null ? [] : [value];
  }),
);

export function isLegalDocumentUrl(value: string): boolean {
  const identity = webDocumentIdentity(value);

  return identity !== null && ALLOWED_LEGAL_DOCUMENT_IDENTITIES.has(identity);
}
