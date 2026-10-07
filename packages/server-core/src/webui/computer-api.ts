import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { HOST_ALIAS } from '@otto/shared/computer'

/**
 * Where the `otto` CLI inside an agent's box reaches the server (C1). The box resolves `host.docker.internal` to the
 * host (DockerComputer adds `--add-host host.docker.internal:host-gateway`); the server's own port usually listens on
 * 127.0.0.1, which a container cannot reach on Linux. So, with `OTTO_COMPUTER=docker`, the server opens a second,
 * small listener that serves `/api/agent/rpc` only (run-token guarded, 404 for anything else):
 * - `OTTO_COMPUTER_API_URL` set: no listener; that URL is what boxes get (you route it).
 * - else on `OTTO_COMPUTER_API_HOST`, default the Docker bridge gateway on Linux (what host-gateway is, read from
 *   `docker network inspect bridge`, else 172.17.0.1) and 127.0.0.1 elsewhere (Docker Desktop forwards
 *   host.docker.internal to the host's loopback), on a free port; boxes get `http://host.docker.internal:<port>`.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void

export interface ComputerApi {
  url: string
  close(): Promise<void>
}

/** The Docker bridge's gateway address (Linux), or null when docker does not answer. */
async function bridgeGateway(docker = 'docker'): Promise<string | null> {
  try {
    const proc = Bun.spawn([docker, 'network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { stdout: 'pipe', stderr: 'ignore' })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    const ip = out.trim()
    return code === 0 && /^[\d.]+$/.test(ip) ? ip : null
  } catch {
    return null
  }
}

export async function startComputerApi(o: { handler: NodeHandler; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): Promise<ComputerApi> {
  const env = o.env ?? process.env
  const explicit = env.OTTO_COMPUTER_API_URL?.trim()
  if (explicit) return { url: explicit.replace(/\/+$/, ''), close: async () => {} }
  const host = env.OTTO_COMPUTER_API_HOST?.trim()
    || ((o.platform ?? process.platform) === 'linux' ? (await bridgeGateway()) ?? '172.17.0.1' : '127.0.0.1')
  const server = createServer(o.handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://${HOST_ALIAS}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
