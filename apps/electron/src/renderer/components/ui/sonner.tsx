import { Toaster as DSToaster } from "@workspace/ui/components/sonner"

/**
 * Adapter over the design-system Toaster. Its look (dark translucent surface in
 * both themes, bottom right, status icons, ghost Close) is fixed by the design
 * system, so this only forwards props. Call sites keep using `toast` from "sonner".
 */
const Toaster = (props: React.ComponentProps<typeof DSToaster>) => (
  <DSToaster {...props} />
)

export { Toaster }
