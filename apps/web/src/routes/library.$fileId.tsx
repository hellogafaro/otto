import { LibraryFileId } from "@otto/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { LibraryDocumentPage } from "../components/library/library-document-page";

export const Route = createFileRoute("/library/$fileId")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function LibraryDocumentRoute() {
    return <LibraryDocumentPage fileId={LibraryFileId.make(Route.useParams().fileId)} />;
  },
});
