import {
  OTTO_DOCUMENTATION_URL,
  OTTO_PRIVACY_POLICY_VERSION,
  OTTO_TERMS_VERSION,
  type ClientSettings,
} from "@otto/contracts/settings";

import { IS_PACKAGED_DESKTOP } from "~/branding";
import { isElectron } from "~/env";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "~/hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function needsPolicyAcknowledgement(
  settings: Pick<ClientSettings, "reviewedPrivacyPolicyVersion" | "reviewedTermsVersion">,
): boolean {
  return (
    settings.reviewedPrivacyPolicyVersion !== OTTO_PRIVACY_POLICY_VERSION ||
    settings.reviewedTermsVersion !== OTTO_TERMS_VERSION
  );
}

export function shouldShowPolicyNotice(input: {
  readonly hydrated: boolean;
  readonly isDesktop: boolean;
  readonly isPackaged: boolean;
  readonly needsAcknowledgement: boolean;
}): boolean {
  return input.hydrated && input.isDesktop && input.isPackaged && input.needsAcknowledgement;
}

export function PolicyNotice() {
  const hydrated = useClientSettingsHydrated();
  const settings = useClientSettings();
  const updateSettings = useUpdateClientSettings();

  const open = shouldShowPolicyNotice({
    hydrated,
    isDesktop: isElectron,
    isPackaged: IS_PACKAGED_DESKTOP,
    needsAcknowledgement: needsPolicyAcknowledgement(settings),
  });

  return (
    <Dialog open={open}>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Review Otto policies</DialogTitle>
          <DialogDescription>
            Otto runs locally. Provider prompts and enabled online features still send data to their
            listed services.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel tone="muted" className="space-y-3">
          <p>
            Read the{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href={`${OTTO_DOCUMENTATION_URL}/LICENSE`}
              target="_blank"
              rel="noreferrer"
            >
              License
            </a>{" "}
            and{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href={`${OTTO_DOCUMENTATION_URL}/docs/user/privacy.md`}
              target="_blank"
              rel="noreferrer"
            >
              Privacy &amp; data
            </a>
            .
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() =>
              updateSettings({
                reviewedPrivacyPolicyVersion: OTTO_PRIVACY_POLICY_VERSION,
                reviewedTermsVersion: OTTO_TERMS_VERSION,
              })
            }
          >
            I reviewed these drafts
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
