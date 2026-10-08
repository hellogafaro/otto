import { openDb } from './index'
import { pushSchema } from './push'

declare const self: { onmessage: (event: MessageEvent<{ path: string }>) => Promise<void>; postMessage: (value: { statements?: string[]; error?: string }) => void }

self.onmessage = async (event: MessageEvent<{ path: string }>) => {
  let db: ReturnType<typeof openDb> | undefined
  try {
    db = openDb(event.data.path)
    const statements = await pushSchema(db)
    db.$client.close()
    db = undefined
    self.postMessage({ statements })
  } catch (error) {
    db?.$client.close()
    self.postMessage({ error: error instanceof Error ? error.message : 'Schema initialization failed.' })
  }
}
