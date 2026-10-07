// Content for scripts/seed-demo.ts: a seeded PRNG, bilingual text pools, chat messages, and tiny PNG / PDF writers.
// Pure: no database, no config, no clock (the caller passes `now`), so the same seed gives the same content.
import { deflateSync } from 'node:zlib'

export const DAY = 86_400_000

export function createRng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
      }
      return copy
    },
  }
}
export type Rng = ReturnType<typeof createRng>

/** How much of everything one run makes. `large` is three times `medium`. */
export interface Scale {
  users: number; agents: number; projects: number; tasks: number; comments: number; chats: number
  longChats: number; longChatLength: number; folders: number; items: number; routines: number; skills: number; sources: number
}
const x3 = (s: Scale): Scale => ({ ...s, users: s.users * 3, agents: s.agents * 3, projects: s.projects * 3, tasks: s.tasks * 3, comments: s.comments * 3, chats: s.chats * 3, longChats: s.longChats * 3, folders: s.folders * 3, items: s.items * 3, routines: s.routines * 3, skills: s.skills * 3, sources: s.sources * 3 })
const MEDIUM: Scale = { users: 8, agents: 6, projects: 14, tasks: 220, comments: 60, chats: 70, longChats: 2, longChatLength: 1500, folders: 5, items: 60, routines: 12, skills: 10, sources: 8 }
export const SCALES: Record<string, Scale> = {
  small: { users: 3, agents: 3, projects: 4, tasks: 30, comments: 10, chats: 10, longChats: 1, longChatLength: 80, folders: 5, items: 14, routines: 6, skills: 3, sources: 4 },
  medium: MEDIUM,
  large: x3(MEDIUM),
}

const pad = (n: number) => String(n).padStart(2, '0')
export const ascii = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')

// ---------------------------------------------------------------------------------------------- people and agents

const FIRST = ['Valentina', 'Marcus', 'Lucía', 'Priya', 'Mateo', 'Sofia', 'Hiroshi', 'Camila', 'Olu', 'Elena', 'Tomás', 'Aisha', 'Diego', 'Mei', 'Julien', 'Ingrid', 'Santiago', 'Fatima', 'Noah', 'Carolina', 'Yuki', 'Andrés', 'Zoe', 'Rafael']
const LAST = ['Ríos', 'Chen', 'Fernández', 'Natarajan', 'Álvarez', 'Lindqvist', 'Tanaka', 'Rojas', 'Adeyemi', 'Petrova', 'Navarro', 'Haddad', 'Okafor', 'Müller', 'Silva', 'Gómez']
export const personName = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 2) % LAST.length]}`

export interface AgentSpec { title: string; instructions: string; provider: string; model: string | null; thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
const AGENTS: AgentSpec[] = [
  { title: 'Researcher 🔎', instructions: '# Role\nYou research a question across the sources you can reach and answer with **evidence**.\n\n## Rules\n- Cite every claim with a link or a library item.\n- Say plainly when you could not verify something.\n- Keep answers under 300 words unless asked.', provider: 'claude-code', model: 'pi/claude-fable-5', thinkingLevel: 'high' },
  { title: 'Redactora', instructions: '# Rol\nEscribes textos de marketing y comunicación en **español neutro**.\n\n## Reglas\n- Tono cercano y directo, frases cortas.\n- Nunca inventes cifras ni citas.\n- Ofrece siempre dos variantes del titular.', provider: 'openai-codex', model: 'pi/gpt-5.6-luna', thinkingLevel: 'medium' },
  { title: 'Code reviewer', instructions: 'Review diffs for bugs, missing tests and unclear names. Reply with a short list ordered by severity; quote the line you mean.', provider: 'anthropic', model: null, thinkingLevel: 'high' },
  { title: 'Data analyst 📊', instructions: 'You answer questions about the workspace data with SQL first, prose second. Show the query you ran and the row count.', provider: 'openrouter', model: 'pi/anthropic/claude-3-haiku', thinkingLevel: 'low' },
  { title: 'Soporte al cliente', instructions: 'Clasificas tickets (urgente, normal, baja) y redactas una primera respuesta amable. Si falta información, pídela en una sola pregunta.', provider: 'openai-codex', model: null, thinkingLevel: 'off' },
  { title: 'Project manager', instructions: '# Role\nKeep projects moving: break goals into tasks, spot blockers, write the weekly status.\n\n> Short, factual, no filler.', provider: 'claude-code', model: 'pi/claude-opus-5-5', thinkingLevel: 'xhigh' },
  { title: 'Traductor EN/ES/日本語', instructions: 'Translate between English, Spanish and Japanese. Keep markdown, code and entity tokens exactly as they are.', provider: 'anthropic', model: null, thinkingLevel: 'medium' },
  { title: 'Release manager', instructions: 'Draft release notes from merged work, grouped by area. Flag anything that needs a migration.', provider: 'openrouter', model: null, thinkingLevel: 'medium' },
  { title: 'Legal reviewer', instructions: 'Read contracts and list obligations, deadlines and unusual clauses. You are not a lawyer; say so once.', provider: 'claude-code', model: 'pi/claude-fable-5', thinkingLevel: 'max' },
  { title: 'Onboarding buddy 👋', instructions: 'Welcome new members, point them to the right project and the right person. Friendly, never pushy.', provider: 'openai-codex', model: 'pi/gpt-5.6-luna', thinkingLevel: 'low' },
  { title: 'Finance assistant', instructions: 'Reconcile invoices against the ledger CSV in the library. Report mismatches as a markdown table.', provider: 'anthropic', model: null, thinkingLevel: 'high' },
  { title: 'Analista de datos ES', instructions: 'Respondes con datos y una conclusión de una línea. Usa tablas cuando compares más de dos cosas.', provider: 'openrouter', model: 'pi/anthropic/claude-3-haiku', thinkingLevel: 'low' },
]
export const agentSpec = (i: number): AgentSpec => {
  const base = AGENTS[i % AGENTS.length]!
  return i < AGENTS.length ? base : { ...base, title: `${base.title} ${Math.floor(i / AGENTS.length) + 1}` }
}

// ---------------------------------------------------------------------------------------------- labels, statuses

export interface LabelSpec { name: string; parent?: string; valueType?: 'string' | 'number' | 'date' | 'link'; color: { light: string; dark: string } }
const c = (light: string, dark: string) => ({ light, dark })
// A two-level tree, valued labels and plain ones: 12 labels.
export const LABELS: LabelSpec[] = [
  { name: 'Area', color: c('#0EA5E9', '#38BDF8') },
  { name: 'Frontend', parent: 'Area', color: c('#6366F1', '#818CF8') },
  { name: 'Backend', parent: 'Area', color: c('#14B8A6', '#2DD4BF') },
  { name: 'Infra', parent: 'Area', color: c('#64748B', '#94A3B8') },
  { name: 'Kind', color: c('#F97316', '#FB923C') },
  { name: 'Feature', parent: 'Kind', color: c('#22C55E', '#4ADE80') },
  { name: 'Fix', parent: 'Kind', color: c('#EF4444', '#F87171') },
  { name: 'Chore', parent: 'Kind', color: c('#A3A3A3', '#D4D4D4') },
  { name: 'Estimate', valueType: 'number', color: c('#EAB308', '#FACC15') },
  { name: 'Sprint', valueType: 'string', color: c('#EC4899', '#F472B6') },
  { name: 'Review by', valueType: 'date', color: c('#8B5CF6', '#A78BFA') },
  { name: 'Spec', valueType: 'link', color: c('#06B6D4', '#22D3EE') },
]

export const STATUSES = [
  { label: 'In progress', category: 'open' as const, icon: '🚧' },
  { label: 'Blocked', category: 'open' as const, icon: '⛔' },
  { label: 'Shipped', category: 'closed' as const, icon: '🚀' },
]

// ---------------------------------------------------------------------------------------------- projects and tasks

const PROJECTS = ['Website redesign', 'Rediseño de la web 🎨', 'Mobile app v2', 'Onboarding de clientes', 'Q4 marketing campaign', 'Billing & invoices 💳', 'Data warehouse migration', 'Customer support playbook', 'Contratación Q4', 'Investor update', 'Brand refresh', 'API v3 launch', 'Herramientas internas', 'Evento anual 2027', 'Security audit 🔐', 'Programa de partners', 'Docs overhaul', 'Pricing experiments', 'Localización (日本語)', 'Customer research']
export const projectTitle = (i: number) => (i < PROJECTS.length ? PROJECTS[i]! : `${PROJECTS[i % PROJECTS.length]} ${2027 + Math.floor(i / PROJECTS.length)}`)

export function projectDescription(r: Rng, title: string): string {
  const es = r.chance(0.35)
  const goal = es ? 'Entregar una primera versión usable antes de fin de trimestre y medir el impacto con clientes reales.' : 'Ship a first usable version before the end of the quarter and measure the impact with real customers.'
  return [
    `# ${title}`,
    '',
    `## ${es ? 'Objetivo' : 'Goal'}`,
    goal,
    '',
    `## ${es ? 'Alcance' : 'Scope'}`,
    ...(es ? ['- Investigación y entrevistas', '- Diseño y prototipo', '- Implementación por fases', '- Lanzamiento y seguimiento'] : ['- Research and interviews', '- Design and prototype', '- Phased implementation', '- Launch and follow-up']),
    '',
    `| ${es ? 'Fase' : 'Phase'} | ${es ? 'Responsable' : 'Owner'} | ${es ? 'Estado' : 'Status'} |`,
    '| --- | --- | --- |',
    `| ${es ? 'Descubrimiento' : 'Discovery'} | ${personName(r.int(0, 23))} | ${es ? 'Hecho' : 'Done'} |`,
    `| ${es ? 'Construcción' : 'Build'} | ${personName(r.int(0, 23))} | ${es ? 'En curso' : 'In progress'} |`,
    '',
    r.chance(0.5) ? '> Decisions are logged in the project comments.' : `**${es ? 'Riesgo' : 'Risk'}:** ${es ? 'dependencia de un proveedor externo' : 'a dependency on an outside vendor'}.`,
  ].join('\n')
}

const VERBS_EN = ['Write', 'Review', 'Fix', 'Design', 'Plan', 'Audit', 'Migrate', 'Document', 'Prototype', 'Test', 'Refactor', 'Measure']
const VERBS_ES = ['Redactar', 'Revisar', 'Corregir', 'Diseñar', 'Planificar', 'Auditar', 'Migrar', 'Documentar', 'Probar', 'Medir']
const THINGS_EN = ['the pricing page', 'onboarding emails', 'the login redirect bug', 'API rate limits', 'dark mode contrast', 'the invoice PDF layout', 'search relevance', 'the CSV export', 'webhook retries', 'the empty states', 'keyboard shortcuts', 'the mobile navigation', 'error messages', 'the release checklist', 'notification settings', 'the data retention policy']
const THINGS_ES = ['la política de reembolsos', 'el informe trimestral', 'los correos de bienvenida', 'el formulario de contacto', 'las notificaciones push', 'la página de precios', 'el flujo de pago', 'la guía de estilo', 'los permisos de equipo', 'el panel de métricas']
const THINGS_OTHER = ['フォームの検証 (form validation)', 'Ελληνικά locale strings', 'RTL layout: العربية', 'emoji picker 🎉🚀', 'ñandú vs. ñu naming', 'Zażółć gęślą jaźń fixtures']
const LONG_TAIL = ' — and make sure the change is documented, tested on slow connections, reviewed by someone outside the team, announced in the changelog, and does not break the existing integrations that customers rely on every single day'

export function taskTitle(r: Rng): string {
  const es = r.chance(0.3)
  let t = es ? `${r.pick(VERBS_ES)} ${r.pick(THINGS_ES)}` : `${r.pick(VERBS_EN)} ${r.pick(r.chance(0.12) ? THINGS_OTHER : THINGS_EN)}`
  if (r.chance(0.12)) t += ` ${r.pick(['🔥', '✅', '🐛', '📌', '⚡', '🎯'])}`
  if (r.chance(0.07)) t = `${t}${LONG_TAIL}`.slice(0, 190)
  if (r.chance(0.08)) t = r.pick(['URGENT: ', 'Hotfix: ', 'Spike: ', 'Q4 · ', 'Revisión · ']) + t
  return t.slice(0, 200)
}

export function taskDescription(r: Rng): string {
  if (r.chance(0.12)) return ''
  const es = r.chance(0.3)
  const parts: string[] = [es ? 'Contexto breve de la tarea y por qué importa ahora.' : 'A short context for the task and why it matters now.']
  if (r.chance(0.6)) parts.push('', `## ${es ? 'Criterios de aceptación' : 'Acceptance criteria'}`, `- [x] ${es ? 'Definir el alcance' : 'Define the scope'}`, `- [ ] ${es ? 'Implementar y probar' : 'Implement and test'}`, `- [ ] ${es ? 'Actualizar la documentación' : 'Update the docs'}`)
  if (r.chance(0.3)) parts.push('', '```ts', 'const retries = Math.min(attempt * 2, 30) // seconds', 'await queue.add(job, { retries })', '```')
  if (r.chance(0.2)) parts.push('', '| Option | Cost | Risk |', '| --- | --- | --- |', '| A | low | medium |', '| B | high | low |')
  if (r.chance(0.2)) parts.push('', `> ${es ? 'Nota: confirmar con el equipo legal.' : 'Note: confirm with legal before shipping.'}`, '', '[Design doc](https://example.com/docs/design) · [Ticket #4821](https://example.com/t/4821)')
  if (r.chance(0.04)) for (let i = 0; i < 40; i++) parts.push('', `### ${es ? 'Sección' : 'Section'} ${i + 1}`, r.pick(PARAS_EN))
  return parts.join('\n')
}

/** Due date: 30% none, 20% overdue, 20% in the next 3 days, 30% later. */
export function dueAt(r: Rng, now: number): number | null {
  const roll = r.next()
  if (roll < 0.3) return null
  if (roll < 0.5) return now - r.int(1, 30) * DAY - r.int(0, 20) * 3_600_000
  if (roll < 0.7) return now + r.int(0, 3) * DAY + r.int(1, 10) * 3_600_000
  return now + r.int(4, 90) * DAY
}

// ---------------------------------------------------------------------------------------------- comments

export function commentText(r: Rng, refs: { users: string[]; tasks: string[]; projects: string[] }, mention?: string): string {
  const es = r.chance(0.35)
  const user = mention ?? (r.chance(0.6) ? r.pick(refs.users) : undefined)
  const lines = [
    es ? r.pick(['Revisé esto y tiene buena pinta.', 'Falta un caso: ¿qué pasa si el cliente no tiene plan?', 'Lo muevo a la siguiente semana, hay un bloqueo.', 'Gracias, ya lo corregí 🙌', 'Adjunto el resultado de la prueba.']) : r.pick(["I checked this and it looks good.", 'One case is missing: what if the customer has no plan?', 'Moving it to next week, there is a blocker.', 'Thanks, fixed 🙌', 'Attaching the test result.', 'Can we split this into two tasks?']),
  ]
  if (user) lines.push(es ? `cc user:${user}, ¿puedes confirmar?` : `cc user:${user}, can you confirm?`)
  if (r.chance(0.3) && refs.tasks.length) lines.push(`${es ? 'Relacionado con' : 'Related to'} task:${r.pick(refs.tasks)}`)
  if (r.chance(0.12) && refs.projects.length) lines.push(`${es ? 'Ver el proyecto' : 'See project'} project:${r.pick(refs.projects)}`)
  if (r.chance(0.12)) lines.push('', '```bash', 'bun test --filter billing', '```')
  if (r.chance(0.05)) lines.push('', ...Array.from({ length: 12 }, () => r.pick(PARAS_EN)))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------- chats

const CHAT_TITLES = [
  'Plan the Q4 launch', 'Resumen de la reunión del lunes', 'Debug the webhook retries', 'Ideas para el newsletter', 'Compare pricing models', 'Draft the quarterly investor update with revenue, burn and hiring plan for the board meeting next month',
  '¿Cómo configuro el dominio?', 'Review PR #482', 'Translate the onboarding emails 日本語', 'Customer interview notes 🎙️', 'SQL: churn by cohort', 'Fix the flaky login test', 'Redactar política de privacidad', 'Release notes v1.4', 'Competitive analysis: Linear vs Notion',
  'Quick question about CSV imports', 'Brainstorm: names for the new feature ✨', 'Auditoría de seguridad: hallazgos', 'Migrate the cron jobs', 'Weekly status', 'Presupuesto 2027', 'Explain this stack trace', 'Landing page copy A/B', 'Estrategia de contenidos',
]
export const chatTitle = (r: Rng, i: number): string => (i < CHAT_TITLES.length ? CHAT_TITLES[i]! : `${r.pick(CHAT_TITLES)} (${i})`)

const USER_PROMPTS_EN = ['Can you summarize the open tasks in this project?', 'Write a short announcement for the new release.', 'Why is the build failing on CI?', 'Compare these two options and recommend one.', 'Turn these notes into action items.', 'Draft a reply to this customer, keep it friendly.', 'Find the file that handles retries and explain it.', 'What changed since last week?', 'Generate a table of the top 5 risks.', 'Can you check the numbers in the attached file?']
const USER_PROMPTS_ES = ['¿Puedes resumir las tareas abiertas de este proyecto?', 'Redacta un anuncio corto para la nueva versión.', '¿Por qué falla la compilación en CI?', 'Compara estas dos opciones y recomienda una.', 'Convierte estas notas en acciones concretas.', 'Prepara una respuesta para este cliente, tono amable.', 'Busca el archivo que gestiona los reintentos y explícalo.', '¿Qué cambió desde la semana pasada?', 'Genera una tabla con los 5 riesgos principales.', 'Revisa las cifras del archivo adjunto.']

export const PARAS_EN = [
  'The short version: the retry loop never resets its backoff, so after the third failure every job waits the maximum time.',
  'I looked at the last 30 days of data. Signups are flat, but activation improved by 12% after the new onboarding checklist shipped.',
  'There are two reasonable options here. The first is cheaper to build; the second is easier to maintain and avoids a migration later.',
  'A few things to double-check before merging: the feature flag default, the rollback path, and the copy on the empty state.',
  'Here is a draft you can paste as is. I kept the tone warm and removed anything that sounds like a promise we cannot keep.',
  'I could not verify the third claim from the sources I have access to, so I left it out rather than guess.',
  'Nothing alarming in the logs, but the p95 latency crept up from 180 ms to 260 ms after Tuesday’s deploy.',
  'This is mostly a naming problem: the function does three things and only one of them is in its name.',
]
export const PARAS_ES = [
  'En resumen: el bucle de reintentos nunca reinicia el tiempo de espera, así que tras el tercer fallo cada tarea espera el máximo.',
  'Revisé los últimos 30 días. Los registros están estables, pero la activación mejoró un 12 % tras lanzar la nueva lista de bienvenida.',
  'Hay dos opciones razonables. La primera es más barata de construir; la segunda es más fácil de mantener y evita una migración después.',
  'Antes de fusionar, conviene revisar tres cosas: el valor por defecto del flag, el plan de vuelta atrás y el texto del estado vacío.',
  'Te dejo un borrador listo para pegar. Mantuve un tono cercano y quité cualquier promesa que no podamos cumplir.',
  'No pude verificar la tercera afirmación con las fuentes a mi alcance, así que la omití en lugar de adivinar.',
]
const CODE = [
  '```ts\nexport async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {\n  for (let attempt = 1; ; attempt++) {\n    try {\n      return await fn()\n    } catch (error) {\n      if (attempt >= tries) throw error\n      await Bun.sleep(2 ** attempt * 100)\n    }\n  }\n}\n```',
  '```python\ndef churn(rows):\n    """Monthly churn by cohort."""\n    out = {}\n    for cohort, lost, total in rows:\n        out[cohort] = round(lost / total * 100, 1)\n    return out\n```',
  '```bash\nbun test packages/shared --filter billing\ngit log --since="1 week ago" --oneline | head -20\n```',
  '```sql\nselect date_trunc(\'month\', created_at) as month, count(*) as signups\nfrom users\ngroup by 1\norder by 1 desc\nlimit 12;\n```',
  '```json\n{ "name": "demo", "retries": 3, "backoff": { "base": 100, "max": 30000 } }\n```',
]
const TABLES = [
  '| Option | Cost | Risk | Notes |\n| --- | --- | --- | --- |\n| A: build | low | medium | 2 weeks |\n| B: buy | high | low | vendor lock-in |\n| C: wait | none | high | revisit in Q1 |',
  '| Mes | MRR | Clientes |\n| --- | ---: | ---: |\n| Jul | 1,200 | 12 |\n| Ago | 1,540 | 15 |\n| Sep | 1,990 | 19 |',
]
const LISTS = [
  '- Check the feature flag default\n- Add a rollback note to the PR\n- Update the empty state copy\n  - English\n  - Español',
  '1. Reproduce the failure locally\n2. Add a failing test\n3. Fix the backoff reset\n4. Ship behind a flag',
  '- [x] Reunión con el cliente\n- [ ] Enviar la propuesta\n- [ ] Actualizar el CRM',
]

function paragraphs(r: Rng, es: boolean, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const roll = r.next()
    out.push(roll < 0.55 ? r.pick(es ? PARAS_ES : PARAS_EN) : roll < 0.7 ? r.pick(CODE) : roll < 0.8 ? r.pick(TABLES) : roll < 0.9 ? r.pick(LISTS) : `## ${es ? 'Siguiente paso' : 'Next step'}\n${r.pick(es ? PARAS_ES : PARAS_EN)}`)
  }
  return out
}

export function answer(r: Rng, es: boolean, size: 'short' | 'medium' | 'long'): string {
  if (size === 'short') return r.pick(es ? PARAS_ES : PARAS_EN)
  return paragraphs(r, es, size === 'medium' ? r.int(2, 4) : r.int(8, 16)).join('\n\n')
}

export interface Attachment { id: string; name: string; mimeType: string; size: number }
export interface Msg {
  id: string; type: 'user' | 'assistant' | 'tool' | 'error' | 'info' | 'plan' | 'warning'; content: string; timestamp: number
  [key: string]: unknown
}
const TOOLS = [
  { name: 'Read', input: () => ({ file_path: '/workspace/src/retry.ts', offset: 1, limit: 200 }), intent: 'Read the retry implementation', result: 'export async function retry<T>(fn: () => Promise<T>) {\n  // ...\n}\n' },
  { name: 'Grep', input: () => ({ pattern: 'backoff', path: '/workspace/src' }), intent: 'Search for the backoff logic', result: 'src/retry.ts:14: const backoff = 2 ** attempt\nsrc/queue.ts:88: backoff: { base: 100 }\n' },
  { name: 'Bash', input: () => ({ command: 'bun test --filter retry' }), intent: 'Run the retry tests', result: 'bun test v1.3\n 12 pass\n  0 fail\nRan 12 tests across 2 files.\n' },
  { name: 'Edit', input: () => ({ file_path: '/workspace/src/retry.ts', old_string: 'attempt * 2', new_string: '2 ** attempt' }), intent: 'Fix the backoff growth', result: 'The file has been updated.' },
  { name: 'WebSearch', input: () => ({ query: 'exponential backoff jitter best practice' }), intent: 'Look up the recommended approach', result: '1. AWS Architecture Blog: Exponential Backoff And Jitter\n2. Google SRE Book: Handling Overload\n' },
  { name: 'mcp__linear__list_issues', input: () => ({ team: 'ENG', state: 'open' }), intent: 'List the open issues', result: '[{"id":"ENG-412","title":"Retry storm on webhook"},{"id":"ENG-430","title":"Slow search"}]' },
]
const ERRORS = [
  { errorCode: 'rate_limited', errorTitle: 'Rate limited', content: 'The provider is rate limiting requests. Try again in a minute.', errorCanRetry: true },
  { errorCode: 'invalid_api_key', errorTitle: 'Invalid credentials', content: 'The connection was rejected. Reconnect the provider in Settings.', errorCanRetry: false },
  { errorCode: 'network_error', errorTitle: 'Network error', content: 'Could not reach the provider (ETIMEDOUT).', errorCanRetry: true },
]

export interface ChatPlan {
  count: number; start: number; es: boolean
  attachments: Attachment[]
  tokens: { tasks: string[]; users: string[] }
  newId: () => string
}

/** `count` messages of a chat: turns of user, tools, intermediate and final answers; errors, plans, interruptions and long answers now and then. */
export function chatMessages(r: Rng, plan: ChatPlan): Msg[] {
  const { count, es, newId } = plan
  const out: Msg[] = []
  let t = plan.start
  let turn = 0
  const tick = (s: number) => (t += s * 1000 + r.int(0, 999))
  while (out.length < count) {
    turn++
    const turnId = `pi-turn-${turn}`
    const attach = r.chance(0.08) && plan.attachments.length ? [r.pick(plan.attachments)] : null
    let text = r.pick(es ? USER_PROMPTS_ES : USER_PROMPTS_EN)
    if (r.chance(0.1) && plan.tokens.tasks.length) text += ` task:${r.pick(plan.tokens.tasks)}`
    if (r.chance(0.05) && plan.tokens.users.length) text += ` user:${r.pick(plan.tokens.users)}`
    if (r.chance(0.04)) text += `\n\n${r.pick(CODE)}`
    out.push({
      id: newId(), type: 'user', content: text, timestamp: tick(r.int(20, 600)),
      ...(attach && { attachments: attach.map((a) => ({ id: a.id, type: a.mimeType.startsWith('image/') ? 'image' : a.mimeType === 'application/pdf' ? 'pdf' : 'text', name: a.name, mimeType: a.mimeType, size: a.size, storedPath: `library/${a.id}` })) }),
    })
    const roll = r.next()
    if (roll < 0.05) {
      const e = r.pick(ERRORS)
      out.push({ id: newId(), type: 'error', timestamp: tick(2), ...e })
      continue
    }
    if (roll < 0.09) {
      out.push({ id: newId(), type: 'assistant', content: r.pick(es ? PARAS_ES : PARAS_EN).slice(0, 60), timestamp: tick(3), isIntermediate: false, partial: true, turnId })
      out.push({ id: newId(), type: 'info', content: 'Response interrupted', infoLevel: 'info', timestamp: tick(1) })
      continue
    }
    if (roll < 0.14) {
      const toolUseId = `call_${newId()}`
      out.push({ id: newId(), type: 'tool', content: 'Running Write...', toolName: 'Write', toolUseId, toolInput: { file_path: 'plans/rollout.md', _displayName: 'Write the rollout plan' }, toolStatus: 'completed', toolResult: 'ok', toolDuration: r.int(40, 400), turnId, timestamp: tick(4) })
      out.push({ id: newId(), type: 'plan', content: `# Plan: roll out the change\n\n1. Ship behind a flag.\n2. Enable for 10% of workspaces.\n3. Watch the error rate for 24 hours.\n4. Enable for everyone.\n\n${r.pick(LISTS)}`, planPath: '{{SESSION_PATH}}/plans/rollout.md', timestamp: tick(2) })
    } else if (roll < 0.55) {
      const tools = r.int(1, roll < 0.25 ? 5 : 2)
      if (r.chance(0.5)) out.push({ id: newId(), type: 'assistant', content: r.pick(es ? ['Voy a revisar el código primero.', 'Déjame buscar el contexto.'] : ['Let me look at the code first.', 'Checking the context.']), isIntermediate: true, turnId, timestamp: tick(3) })
      for (let k = 0; k < tools; k++) {
        const tool = r.pick(TOOLS)
        const failed = r.chance(0.08)
        out.push({
          id: newId(), type: 'tool', content: `Running ${tool.name}...`, toolName: tool.name, toolUseId: `call_${newId()}`,
          toolInput: { ...tool.input(), _displayName: tool.name, _intent: tool.intent }, toolStatus: failed ? 'error' : 'completed', toolIntent: tool.intent,
          toolResult: failed ? 'Error: command failed with exit code 1' : r.chance(0.05) ? Array.from({ length: 80 }, (_, i) => `line ${i + 1}: ${tool.result.trim().split('\n')[0]}`).join('\n') : tool.result,
          ...(failed && { isError: true }), toolDuration: r.int(20, 4000), turnId, timestamp: tick(r.int(1, 6)),
        })
      }
    }
    const sizeRoll = r.next()
    out.push({ id: newId(), type: 'assistant', content: answer(r, es, sizeRoll < 0.5 ? 'short' : sizeRoll < 0.93 ? 'medium' : 'long'), isIntermediate: false, turnId, timestamp: tick(r.int(2, 30)) })
  }
  out.length = count
  return out
}

export const CHAT_MODELS = ['pi/gpt-5.6-luna', 'pi/claude-fable-5', 'pi/anthropic/claude-3-haiku', 'claude-opus-5-5']

// ---------------------------------------------------------------------------------------------- routines, skills, sources

export interface RoutineSpec { title: string; type: 'schedule' | 'event' | 'webhook'; cron?: string; event?: string; prompt: string }
const ROUTINES: RoutineSpec[] = [
  { title: 'Daily digest ☀️', type: 'schedule', cron: '0 9 * * 1-5', prompt: 'Summarize yesterday’s activity across projects and list what is overdue.' },
  { title: 'Informe semanal', type: 'schedule', cron: '0 8 * * 1', prompt: 'Prepara el informe semanal: tareas cerradas, bloqueos y próximos pasos.' },
  { title: 'Inbox triage', type: 'schedule', cron: '*/30 * * * *', prompt: 'Triage the unread notifications and propose a reply for each mention.' },
  { title: 'Backup check 💾', type: 'schedule', cron: '15 3 * * *', prompt: 'Verify last night’s backup finished and report the size.' },
  { title: 'Resumen de ventas', type: 'schedule', cron: '0 18 * * 5', prompt: 'Resume las ventas de la semana en una tabla y destaca los cambios grandes.' },
  { title: 'Dependency audit', type: 'schedule', cron: '0 6 1 * *', prompt: 'Audit the dependencies for known vulnerabilities and open tasks for the serious ones.' },
  { title: 'Notify on new label', type: 'event', event: 'LabelAdd', prompt: 'A label was added. If it is `Fix`, tell the owner in one sentence.' },
  { title: 'Summarize on session end', type: 'event', event: 'SessionEnd', prompt: 'Write a two-line summary of the chat that just ended.' },
  { title: 'Flag change watcher', type: 'event', event: 'FlagChange', prompt: 'Explain why this chat was flagged, if the reason is in the transcript.' },
  { title: 'GitHub release webhook', type: 'webhook', prompt: 'A release was published. Draft release notes from the payload.' },
  { title: 'Stripe payments webhook 💳', type: 'webhook', prompt: 'Review this payment event and flag anything unusual.' },
  { title: 'Formulario de contacto', type: 'webhook', prompt: 'Clasifica este mensaje de contacto y redacta una primera respuesta.' },
]
export const routineSpec = (i: number): RoutineSpec => {
  const base = ROUTINES[i % ROUTINES.length]!
  return i < ROUTINES.length ? base : { ...base, title: `${base.title} (${Math.floor(i / ROUTINES.length) + 1})` }
}

const SKILLS = [
  ['code-review', 'Code review', '🧐', 'Review a diff for bugs, tests and naming.'],
  ['release-notes', 'Release notes', '📝', 'Turn merged work into grouped release notes.'],
  ['traducir-es-en', 'Traducir ES/EN', '🌐', 'Traduce textos entre español e inglés conservando el formato.'],
  ['meeting-summary', 'Meeting summary', '🗒️', 'Summarize a meeting into decisions and action items.'],
  ['sql-helper', 'SQL helper', '🗄️', 'Write and explain SQL against the workspace data.'],
  ['brand-voice', 'Brand voice', '🎙️', 'Rewrite copy in the brand voice.'],
  ['bug-triage', 'Bug triage', '🐛', 'Classify bug reports by severity and area.'],
  ['resumen-ejecutivo', 'Resumen ejecutivo', '📈', 'Crea un resumen ejecutivo de una página.'],
  ['api-docs', 'API docs', '📚', 'Document an endpoint with examples.'],
  ['onboarding-checklist', 'Onboarding checklist', '✅', 'Build an onboarding checklist for a new teammate.'],
] as const
export function skillFiles(i: number): { slug: string; files: Map<string, Uint8Array> } {
  const [base, name, icon, description] = SKILLS[i % SKILLS.length]!
  const slug = i < SKILLS.length ? base : `${base}-${Math.floor(i / SKILLS.length) + 1}`
  const text = (s: string) => new TextEncoder().encode(s)
  const md = `---\nname: ${name}${i < SKILLS.length ? '' : ` ${Math.floor(i / SKILLS.length) + 1}`}\ndescription: ${description}\nicon: ${icon}\n---\n\n# ${name}\n\n${description}\n\n## When to use\n\n- The request matches the description above.\n- Cuando el usuario lo pide en español, responde en español.\n\n## Steps\n\n1. Read the input.\n2. Follow \`references/style.md\`.\n3. Run \`scripts/check.sh\` before answering.\n\n\`\`\`bash\nbash scripts/check.sh "$INPUT"\n\`\`\`\n`
  const files = new Map<string, Uint8Array>([
    ['SKILL.md', text(md)],
    ['references/style.md', text(`# Style\n\n- Short sentences.\n- Keep markdown intact.\n- ${name}: be specific.\n`)],
    ['scripts/check.sh', text('#!/usr/bin/env bash\nset -euo pipefail\ntest -n "${1:-}" || { echo "empty input" >&2; exit 1; }\necho ok\n')],
  ])
  if (i % 2 === 0) files.set('examples/sample.json', text(JSON.stringify({ input: 'example', expected: 'ok' }, null, 2)))
  return { slug, files }
}

export interface SourceSpec { name: string; slug: string; type: 'mcp' | 'api' | 'local'; status: 'ok' | 'needs_auth' | 'error'; config: Record<string, unknown>; tagline: string }
const SOURCES: SourceSpec[] = [
  { name: 'Linear', slug: 'demo-linear', type: 'mcp', status: 'needs_auth', tagline: 'Issues and cycles', config: { provider: 'linear', mcp: { transport: 'http', url: 'https://mcp.example.com/linear', authType: 'oauth' } } },
  { name: 'GitHub', slug: 'demo-github', type: 'api', status: 'ok', tagline: 'Repos, PRs and issues', config: { provider: 'github', isAuthenticated: true, api: { baseUrl: 'https://api.github.com/', authType: 'bearer' } } },
  { name: 'Notion', slug: 'demo-notion', type: 'mcp', status: 'ok', tagline: 'Docs and wikis', config: { provider: 'notion', isAuthenticated: true, mcp: { transport: 'http', url: 'https://mcp.example.com/notion', authType: 'bearer' } } },
  { name: 'Docs folder', slug: 'demo-docs-folder', type: 'local', status: 'ok', tagline: 'Local markdown notes', config: { provider: 'filesystem', local: { path: '/tmp/demo-docs', format: 'filesystem' } } },
  { name: 'Stripe', slug: 'demo-stripe', type: 'api', status: 'error', tagline: 'Payments and invoices', config: { provider: 'stripe', isAuthenticated: true, connectionStatus: 'failed', connectionError: 'HTTP 401: the key was revoked', api: { baseUrl: 'https://api.stripe.com/', authType: 'bearer' } } },
  { name: 'Slack', slug: 'demo-slack', type: 'api', status: 'needs_auth', tagline: 'Channels and messages', config: { provider: 'slack', api: { baseUrl: 'https://slack.com/api/', authType: 'bearer' } } },
  { name: 'Postgres (read-only)', slug: 'demo-postgres', type: 'mcp', status: 'ok', tagline: 'Analytics queries', config: { provider: 'postgres', mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@example/mcp-postgres'], authType: 'none' } } },
  { name: 'Weather', slug: 'demo-weather', type: 'api', status: 'ok', tagline: 'Public forecast API', config: { provider: 'weather', api: { baseUrl: 'https://api.weather.example.com/', authType: 'none' } } },
]
export const sourceSpec = (i: number): SourceSpec => {
  const base = SOURCES[i % SOURCES.length]!
  if (i < SOURCES.length) return base
  const n = Math.floor(i / SOURCES.length) + 1
  return { ...base, name: `${base.name} ${n}`, slug: `${base.slug}-${n}` }
}

// ---------------------------------------------------------------------------------------------- library

const DOC_TITLES = ['Welcome', 'Project brief', 'Meeting notes', 'Style guide', 'Q3 report', 'Ideas', 'Guía de bienvenida', 'Notas de la reunión', 'Roadmap 2027', 'Retro: lo que aprendimos', 'Pricing research', 'Interview script', 'Brand voice', 'Onboarding checklist', 'Postmortem: webhook outage', 'Propuesta comercial', 'FAQ', 'Release plan', 'Glosario ES/EN', 'Weekly log']
export const FOLDER_TREE: { title: string; parent: number | null }[] = [
  { title: 'Company', parent: null }, { title: 'Brand', parent: 0 }, { title: 'Logos', parent: 1 }, { title: 'Reports 📁', parent: null }, { title: '2026', parent: 3 },
]
export function folderSpec(i: number): { title: string; parent: number | null } {
  if (i < FOLDER_TREE.length) return FOLDER_TREE[i]!
  const base = FOLDER_TREE[i % FOLDER_TREE.length]!
  const group = Math.floor(i / FOLDER_TREE.length)
  return { title: `${base.title} ${group + 1}`, parent: base.parent === null ? null : i - (i % FOLDER_TREE.length) + base.parent }
}

export function documentText(r: Rng, title: string): string {
  const es = /Gu[ií]a|Notas|Retro|Propuesta|Glosario/.test(title) || r.chance(0.3)
  const body = paragraphs(r, es, r.chance(0.1) ? 30 : r.int(3, 8))
  return `# ${title}\n\n${body.join('\n\n')}\n`
}
export const docTitle = (i: number) => (i < DOC_TITLES.length ? `${DOC_TITLES[i]}.md` : `${DOC_TITLES[i % DOC_TITLES.length]} ${Math.floor(i / DOC_TITLES.length) + 1}.md`)

export function textFile(r: Rng, i: number): { title: string; mime: string; text: string } {
  const kind = i % 4
  if (kind === 0) return { title: `notes-${i}.txt`, mime: 'text/plain', text: `${r.pick(PARAS_EN)}\n${r.pick(PARAS_ES)}\n` }
  if (kind === 1) return { title: `customers-${i}.csv`, mime: 'text/csv', text: `name,plan,mrr\n${Array.from({ length: 12 }, (_, k) => `Cliente ${k + 1},${r.pick(['pro', 'team', 'free'])},${r.int(0, 400)}`).join('\n')}\n` }
  if (kind === 2) return { title: `config-${i}.json`, mime: 'application/json', text: JSON.stringify({ name: `demo-${i}`, retries: r.int(1, 5), tags: ['demo', 'ñ', '日本語'] }, null, 2) }
  return { title: `script-${i}.sh`, mime: 'text/x-shellscript', text: `#!/usr/bin/env bash\necho "demo ${i}"\n` }
}

// ---------------------------------------------------------------------------------------------- binary files

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let v = n
  for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
  return v >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let v = 0xffffffff
  for (const b of bytes) v = crcTable[(v ^ b) & 0xff]! ^ (v >>> 8)
  return (v ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** A PNG of a diagonal gradient between two colors with a soft ring: enough to tell the images apart. */
export function pngImage(width: number, height: number, from: [number, number, number], to: [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const ring = Math.abs(Math.hypot(x - width / 2, y - height / 2) - Math.min(width, height) / 3) < 3 ? 60 : 0
      for (let ch = 0; ch < 3; ch++) raw[y * (width * 3 + 1) + 1 + x * 3 + ch] = Math.min(255, Math.round(from[ch]! + (to[ch]! - from[ch]!) * t) + ring)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
export const randomColor = (r: Rng): [number, number, number] => [r.int(30, 220), r.int(30, 220), r.int(30, 220)]

/** A one-page PDF (Helvetica, ASCII text). */
export function pdfDocument(text: string): Uint8Array {
  const safe = text.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '')
  const stream = `BT /F1 18 Tf 30 100 Td (${safe}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

export const stamp = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
