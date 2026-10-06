// The chat's side of the shell composer (the input itself is `components/composer/`).
export { StructuredInput } from './structured-input'

// Structured input components
export { PermissionRequest } from './structured/permission-request'

// Types
export type {
  InputMode,
  StructuredInputType,
  StructuredInputState,
  StructuredInputData,
  StructuredResponse,
  PermissionResponse,
  AdminApprovalResponse,
} from './structured/types'
