// The `otto` CLI an agent runs through bash (docs/final-plan.md PT): `otto <command> [args...]`, `otto help` for the
// list. It sends its arguments as typed to the server's /api/agent/rpc with the turn's run token, which the server
// checks, maps through its agent channel table and runs as the chat's user; this file knows no command. An argument
// that is `-` is read from stdin. Prints the JSON result (or the error) and exits 0 on success, 1 on a refused or
// failed call, 2 when it cannot run. Runs on Bun or Node 18+, no dependencies.

const url = process.env.OTTO_API_URL
const token = process.env.OTTO_RUN_TOKEN
if (!url || !token) {
  process.stderr.write('otto: no run token here. The otto command works inside an agent\'s turn only.\n')
  process.exit(2)
}

async function stdinText() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const args = process.argv.slice(2)
const argv = []
for (const arg of args) argv.push(arg === '-' ? await stdinText() : arg)

let response
try {
  response = await fetch(`${url}/api/agent/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
  })
} catch (error) {
  process.stderr.write(`otto: cannot reach the server (${error instanceof Error ? error.message : String(error)})\n`)
  process.exit(2)
}

const text = await response.text()
let body
try {
  body = JSON.parse(text)
} catch {
  process.stderr.write(`otto: unexpected answer (HTTP ${response.status})\n`)
  process.exit(2)
}
if (response.ok && typeof body.result === 'string') process.stdout.write(`${body.result}\n`)
else process.stdout.write(`${JSON.stringify(response.ok ? body.result : body, null, 2)}\n`)
process.exit(response.ok ? 0 : 1)
