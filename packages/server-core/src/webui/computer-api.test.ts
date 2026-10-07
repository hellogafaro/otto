import { describe, expect, it } from 'bun:test'
import { startComputerApi } from './computer-api'

describe('startComputerApi', () => {
  it('OTTO_COMPUTER_API_URL is used as is, with no listener', async () => {
    const api = await startComputerApi({ handler: () => {}, env: { OTTO_COMPUTER_API_URL: 'http://10.0.0.5:7000/' } })
    expect(api.url).toBe('http://10.0.0.5:7000')
    await api.close()
  })

  it('else a listener on OTTO_COMPUTER_API_HOST that boxes reach as host.docker.internal', async () => {
    const api = await startComputerApi({
      handler: (req, res) => { res.writeHead(200); res.end(`rpc ${req.url}`) },
      env: { OTTO_COMPUTER_API_HOST: '127.0.0.1' },
    })
    const port = new URL(api.url).port
    expect(api.url).toBe(`http://host.docker.internal:${port}`)
    expect(await (await fetch(`http://127.0.0.1:${port}/api/agent/rpc`, { method: 'POST' })).text()).toBe('rpc /api/agent/rpc')
    await api.close()
  })
})
