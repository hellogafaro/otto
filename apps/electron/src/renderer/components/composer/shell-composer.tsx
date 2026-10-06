/**
 * ShellComposer - the host of the ONE composer (`FreeFormInput`) in the page frame's composer slot: it hands the
 * single instance the page's context (`useComposerContext`) and the handle `useComposer()` drives. Mounted once by
 * the shell, so the instance never remounts as pages change; it only positions, the composer is `FreeFormInput`.
 */

import { FreeFormInput } from '@/components/app-shell/input/free-form-input'
import { useComposerShell } from './composer-provider'

export function ShellComposer() {
  const { context, handleRef } = useComposerShell()
  return <FreeFormInput context={context} handleRef={handleRef} />
}
