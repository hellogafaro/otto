/** Every library item of the workspace, folders included (`useLibrary` loads it; pages filter and derive folder paths). */

import type { LibraryItem } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const libraryAtom = workspaceListAtom<LibraryItem>()
