import { DB_PATH } from './index'

export async function initSchema(path = DB_PATH): Promise<string[]> {
  const entry = new URL(import.meta.url).pathname.endsWith('/server.js') ? './schema-worker.js' : './push-worker.ts'
  const worker = new Worker(new URL(entry, import.meta.url).href, { preload: [] })
  try {
    return await new Promise<string[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ statements?: string[]; error?: string }>) => {
        if (event.data.error) reject(new Error(event.data.error))
        else if (event.data.statements) resolve(event.data.statements)
        else reject(new Error('Schema initialization returned no result.'))
      }
      worker.onerror = () => reject(new Error('Schema initialization worker failed.'))
      worker.postMessage({ path })
    })
  } finally {
    worker.terminate()
  }
}
