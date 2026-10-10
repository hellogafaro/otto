import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { SettingsDialog, SettingsField, useSettingsAction } from "./controls";

type Connection = InferResponseType<
  typeof workspaceApi.connections.$get
>["items"][number];

export function ConnectionCredentialDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsAction();
  const [editToken] = useState(connection.editToken);
  const [reference, setReference] = useState("");
  return (
    <SettingsDialog
      title={`Complete credential reference: ${connection.title}`}
      description="Human-only secure completion. Enter an existing deployment-approved reference, never a key or token. Saved references are not shown. Replacing the reference disconnects the Connection and revokes grants; activate it through an exact composer approval afterward."
      open={open}
      onOpenChange={onOpenChange}
      pending={action.pending}
      error={action.error}
      submitLabel="Replace reference"
      onSubmit={async () => {
        if (
          await action.perform(async () => {
            if (!/^[\w.:/-]{1,200}$/.test(reference))
              throw new Error(
                "Enter an existing deployment-approved reference, not a credential value.",
              );
            await read(
              await api.connections[":id"].$patch({
                param: { workspaceId, id: connection.id },
                json: { editToken, credentialRef: reference },
              }),
            );
          }, "Credential reference replaced")
        )
          onOpenChange(false);
      }}
    >
      <SettingsField
        label="Credential reference"
        value={reference}
        required
        maxLength={200}
        type="password"
        autoComplete="off"
        onChange={(event) => setReference(event.target.value.trim())}
      />
    </SettingsDialog>
  );
}
