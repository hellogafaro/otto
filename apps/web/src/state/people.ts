import type { OrganizationAccountState } from "@otto/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { environmentSnapshotAtom } from "./shell";

/** The signed-in account as the accounts API last returned it, shared by every reader. */
export const organizationAccountAtom = Atom.make<{
  readonly baseURL: string;
  readonly state: OrganizationAccountState;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("web-organization-account"));

/**
 * A person's profile photo, or null for their initials. The signed-in person's own photo comes
 * from their account, so a change shows everywhere at once; everyone else's comes from the
 * people in each loaded environment.
 */
export const personImageAtom = Atom.family((personId: string) =>
  Atom.make((get): string | null => {
    const user = get(organizationAccountAtom)?.state.user;

    if (user && user.id === personId) return user.image ?? null;

    const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));

    if (!personId || Option.isNone(catalog)) return null;

    for (const environmentId of catalog.value.entries.keys()) {
      const person = get(environmentSnapshotAtom(environmentId))?.people?.find(
        (candidate) => candidate.personId === personId,
      );

      if (person?.image) return person.image;
    }

    return null;
  }).pipe(Atom.withLabel(`web-person-image:${personId}`)),
);
