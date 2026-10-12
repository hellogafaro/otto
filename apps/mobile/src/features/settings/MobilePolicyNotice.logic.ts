import { OTTO_PRIVACY_POLICY_VERSION, OTTO_TERMS_VERSION } from "@otto/contracts/settings";

export function needsMobilePolicyAcknowledgement(preferences: {
  readonly reviewedPrivacyPolicyVersion?: string;
  readonly reviewedTermsVersion?: string;
}): boolean {
  return (
    preferences.reviewedPrivacyPolicyVersion !== OTTO_PRIVACY_POLICY_VERSION ||
    preferences.reviewedTermsVersion !== OTTO_TERMS_VERSION
  );
}

export function shouldShowMobilePolicyNotice(input: {
  readonly appVariant: string;
  readonly loaded: boolean;
  readonly needsAcknowledgement: boolean;
}): boolean {
  return input.loaded && input.appVariant !== "development" && input.needsAcknowledgement;
}
