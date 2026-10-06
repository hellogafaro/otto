import { registerPiModelResolver } from '../../src/config/llm-connections.ts'
import { getAllPiModels, getPiModelsForAuthProvider } from '../../src/config/models-pi.ts'

registerPiModelResolver((provider?: string) =>
  provider ? getPiModelsForAuthProvider(provider) : getAllPiModels(),
)
