import * as React from "react"
import { Separator as DsSeparator } from "@workspace/ui/components/separator"

/** Radix's `decorative` is the default in Base UI (a plain separator), so it is accepted and dropped. */
function Separator({
  decorative: _decorative,
  ...props
}: React.ComponentProps<typeof DsSeparator> & { decorative?: boolean }) {
  return <DsSeparator {...props} />
}

export { Separator }
