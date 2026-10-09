from pathlib import Path
from html import escape
import os, re

source = Path('/home/g4f4r0/projects/otto/OTTO_CODE_PRINCIPLES.md')
root = Path(os.environ['BB_THREAD_STORAGE']) / 'canvas'
md = source.read_text()
plan_status = "Final plan" if "Final plan," in md else "Revised draft"
kit = Path('/home/g4f4r0/.local/bb/packages/bb-app/server/dist/builtin-plugins/canvas/skills/canvas/references/kit.css').read_text()
parts = re.split(r'(?=/\* )', kit)
keep = ['BB canvas kit', 'Base', 'Layout', 'Page header', 'Badge', 'Table', 'Steps', 'Footer']
css = ''.join(p for p in parts if any(p.startswith('/* ' + key) for key in keep))
css += '''
.page { max-width:1000px; }
nav { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:8px; font-size:13px; }
section { scroll-margin-top:16px; }
.section > p, .section > ul, .section > ol, .section > .table-wrap, .section > figure { margin-top:14px; }
.section > h2 + p { color:var(--muted-foreground); }
.table td { vertical-align:top; overflow-wrap:break-word; }
.table th { white-space:normal; }
.table th:first-child,.table td:first-child { width:18%; font-weight:500; }
.table-wrap { margin:16px 0; }
.steps { margin-top:16px; }
.step-body { margin-top:0; }
figure { margin:20px 0; border:1px solid var(--border); border-radius:var(--radius); background:var(--card); }
.diagram-scroll { overflow-x:auto; padding:12px; }
.diagram { display:block; width:100%; min-width:690px; height:auto; font-family:var(--font-sans); }
.diagram rect { fill:var(--background); stroke:var(--border); stroke-width:1.4; }
.diagram .highlight rect { fill:var(--tint-primary); stroke:var(--primary); }
.diagram .d-title { fill:var(--foreground); font-size:15px; font-weight:600; }
.diagram .d-sub { fill:var(--muted-foreground); font-size:13px; }
.diagram .edge { fill:none; stroke:var(--muted-foreground); stroke-width:1.5; }
.diagram .arrow { fill:var(--muted-foreground); }
.diagram .d-label { fill:var(--muted-foreground); font-size:12px; }
.diagram .annotation { fill:var(--primary); font-size:13px; font-weight:500; }
figcaption { padding:10px 16px; border-top:1px solid var(--border); color:var(--muted-foreground); font-size:13px; }
.summary { padding:14px 16px; margin-top:14px; background:var(--muted); border-radius:var(--radius); }
.summary p { max-width:none; }
@media(max-width:600px) { .page { padding:20px 16px 40px; } .table { min-width:620px; } .diagram-scroll { padding:8px; } }
@media print { :root { color-scheme:light; } .page { max-width:none; } nav { display:none; } figure,tr { break-inside:avoid; } .diagram { min-width:0; } }
'''

def inline(text):
    text = escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    local_links = {'OTTO_REFERENCES.md': '#references', 'OTTO_PLAN.md': '#fixed-choices', 'OTTO_FOUNDATION_RESEARCH.md': '#references', 'OTTO_REFERENCES.md#buzz': '#references', 'OTTO_CODE_PRINCIPLES.md': '#references'}
    def link(match):
        href = match[2]
        if href.startswith('https://') or href in local_links:
            return '<a href="' + local_links.get(href, href) + '">' + match[1] + '</a>'
        return match[0]
    return re.sub(r'\[([^\]]+)\]\(([^ )]+)\)', link, text)

def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

class Diagram:
    def __init__(self, key, height, title, desc):
        self.key = key
        self.height = height
        self.title = title
        self.desc = desc
        self.edges = []
        self.nodes = []
    def box(self, x, y, w, title, sub='', h=66, highlight=False):
        klass = 'highlight' if highlight else ''
        title_y = y + 28 if sub else y + h / 2 + 5
        self.nodes.append(f'<g class="{klass}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/><text class="d-title" text-anchor="middle" x="{x+w/2}" y="{title_y}">{escape(title)}</text>' + (f'<text class="d-sub" text-anchor="middle" x="{x+w/2}" y="{y+49}">{escape(sub)}</text>' if sub else '') + '</g>')
    def line(self, path, label='', x=0, y=0, both=False, dashed=False):
        opts = f' marker-end="url(#{self.key}-arrow)"'
        if both: opts += f' marker-start="url(#{self.key}-arrow)"'
        if dashed: opts += ' stroke-dasharray="5 4"'
        self.edges.append(f'<path class="edge" d="{path}"{opts}/>' + (f'<text class="d-label" text-anchor="middle" x="{x}" y="{y}">{escape(label)}</text>' if label else ''))
    def note(self, x, y, text):
        self.nodes.append(f'<text class="annotation" text-anchor="middle" x="{x}" y="{y}">{escape(text)}</text>')
    def render(self, caption):
        svg = f'<svg class="diagram" viewBox="0 0 880 {self.height}" role="img" aria-labelledby="{self.key}-title {self.key}-desc"><title id="{self.key}-title">{escape(self.title)}</title><desc id="{self.key}-desc">{escape(self.desc)}</desc><defs><marker id="{self.key}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="arrow" d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>' + ''.join(self.edges + self.nodes) + '</svg>'
        return '<figure><div class="diagram-scroll" tabindex="0" role="region" aria-label="' + escape(self.title, quote=True) + '">' + svg + '</div><figcaption>' + escape(caption) + '</figcaption></figure>'

def relationships():
    d = Diagram('relationships', 900, 'The records and their relationships', 'A project groups peer tasks, conversations, and documents. Each task has a human owner and a human or agent assignee. Collections organize documents. Conversations hold messages and independent runs; runs use a reusable agent and can reference a task.')
    d.box(335, 10, 210, 'Project', 'Members and defaults', highlight=True)
    d.box(15, 128, 220, 'Task', 'One flat piece of work', highlight=True)
    d.box(330, 128, 220, 'Conversation', 'Members + shared timeline', highlight=True)
    d.box(645, 128, 220, 'Document', 'Note / specification / skill', highlight=True)
    for x in [125, 440, 755]: d.line(f'M 440 76 V 99 H {x} V 128')
    d.line('M 235 160 H 330', 'links', 282, 150, both=True)
    d.line('M 550 160 H 645', 'links', 596, 150, both=True)
    d.box(15, 260, 220, 'Human owner', 'Responsible for the outcome')
    d.box(15, 386, 220, 'Assignee', 'Human / agent / unassigned')
    d.line('M 80 260 V 194', 'required', 120, 237)
    d.line('M 235 419 H 266 V 213 H 176 V 194')
    d.box(330, 260, 220, 'Messages', 'Authors, replies, files')
    d.box(330, 386, 220, 'Sessions', 'Private continuing context')
    d.box(330, 565, 220, 'Runs', 'Prompt or script attempt')
    d.line('M 440 452 V 565')
    d.line('M 412 194 V 260')
    d.line('M 550 179 H 585 V 355 H 500 V 386')
    d.box(645, 260, 220, 'Collection', 'Fields and saved views')
    d.line('M 755 260 V 194', 'organizes', 799, 237)
    d.box(645, 386, 220, 'Reusable agent', 'Tools and selected skills')
    d.line('M 645 419 H 550', 'owns Session', 597, 408)
    d.line('M 330 598 H 285 V 184 H 235', 'optional task', 272, 493)
    d.line('M 550 160 H 620 V 530 H 500 V 565', 'script', 595, 522)
    d.box(15, 565, 220, 'Connection', 'Auth, tools, agent grants')
    d.box(15, 720, 220, 'Automation', 'Manual / cron, prompt / script', highlight=True)
    d.line('M 235 753 H 307 V 620 H 330')
    d.box(645, 565, 220, 'Own Environment', 'Computer + working files', highlight=True)
    d.box(330, 720, 220, 'Artifact', 'One saved output', highlight=True)
    d.box(645, 720, 220, 'Library view', 'Find and reuse artifacts')
    d.line('M 755 452 V 565', 'owns', 797, 518)
    d.line('M 550 598 H 645', 'executes in', 597, 587)
    d.line('M 235 598 V 680 H 605 V 620 H 645', 'scoped grants', 355, 672)
    d.line('M 440 631 V 720', 'produces', 485, 700)
    d.line('M 550 753 H 645', 'appears in', 597, 742)
    d.note(440, 851, 'Conversation is shared. Each agent owns its computer. Outputs are saved separately.')
    return d.render('Library is a view. Session holds continuing context; Run records one attempt; Environment holds the agent computer.')

def conversation():
    d = Diagram('conversation', 640, 'Conversation, Session, Run, and Environment', "Conversation owns participants and a shared timeline without a type field. Session holds one agent's private continuing harness context. Prompt Runs reference a Session; script Runs need none. Both execute in the agent environment and save selected outputs.")
    d.box(265,10,350,'Conversation','Shared discussion; no type field',highlight=True)
    for x,title,sub,w in [(10,'Memberships','People and agents',250),(320,'Messages','Shared timeline and files',250),(630,'Access','Explicit permissions and sharing',240)]:
        d.box(x,122,w,title,sub)
        d.line(f'M 440 76 V 98 H {x+w/2} V 122')
    d.box(10,250,220,'Agent','Identity + instructions')
    d.box(265,250,350,'Session','Private continuing harness context',highlight=True)
    d.box(650,250,220,'Environment','Agent computer + working files')
    d.line('M 615 43 H 625 V 283 H 615')
    d.line('M 230 283 H 265')
    d.line('M 615 283 H 650')
    d.box(265,380,350,'Prompt Run','One bounded attempt')
    d.box(650,380,220,'Script Run','No Session or LLM required')
    d.line('M 440 316 V 380')
    d.line('M 615 43 H 877 V 413 H 870')
    d.line('M 615 413 H 640 V 300 H 650')
    d.line('M 760 380 V 316')
    d.box(265,515,350,'Selected results','Conversation messages + artifacts',highlight=True)
    d.line('M 440 446 V 515')
    d.line('M 760 446 V 548 H 615')
    d.note(440,617,'Within one scope: fresh Session resets context, keeping history and the computer.')
    return d.render('Several agents can have Sessions in one Conversation. One Session can span several Runs. Private harness history is not published.')

def dataflow():
    d = Diagram('dataflow', 780, 'Work, isolated execution, connections, and saved outputs', 'Authenticated internal commands save a run and pending work. The server runtime leases the agent environment and prepares authorized context. The agent executes in its own computer with scoped external connections, then saves durable artifacts and messages. Saved records stream back to people and agents.')
    d.box(275, 10, 330, 'People and agents', 'Actions, messages, directed requests')
    d.box(275, 110, 330, 'Internal domain commands', 'Authenticated server operations', highlight=True)
    d.line('M 440 76 V 110')
    d.box(275, 210, 330, 'Atomic save', 'Run inputs + pg-boss dispatch job', highlight=True)
    d.line('M 440 176 V 210')
    d.box(30, 310, 250, 'Server runtime claims run', 'Environment lease + launch identity')
    d.line('M 350 276 V 294 H 155 V 310')
    d.box(30, 410, 250, 'Prepare context', 'Session + saved authorized inputs')
    d.line('M 155 376 V 410')
    d.box(30, 510, 250, "Agent's own computer", 'Private files, processes, browser', highlight=True)
    d.line('M 155 476 V 510')
    d.box(340, 630, 230, 'Save outputs', 'Artifacts + messages + result', highlight=True)
    d.line('M 155 576 V 663 H 340')
    d.box(620, 310, 230, 'Durable storage', 'Records + artifact bytes', highlight=True)
    d.line('M 530 276 V 294 H 735 V 310')
    d.line('M 570 663 H 870 V 343 H 850')
    d.box(620, 110, 230, 'Authorized delivery', 'Live stream + catch-up')
    d.line('M 735 310 V 176', 'saved first', 786, 250)
    d.line('M 735 110 V 43 H 605')
    d.box(620, 510, 230, 'Connections', 'Credentials, tools, access')
    d.line('M 620 543 H 280', 'only granted access', 452, 531)
    d.note(440, 747, 'Saved artifacts outlive the computer. Reconnect replays saved updates.')
    return d.render('Trusted coordination stays outside agent computers. No separate Otto API service or shared agent home directory.')


def environments():
    d = Diagram('environments', 440, 'One environment for each agent', 'An agent identity owns its primary environment. A conversation run claims that environment and uses only its scoped connection grants. Each environment supplies its own computer, persistent working files, and separate browser and process state. The team workspace remains the home of shared records.')
    d.box(20, 10, 250, 'Agent', 'Identity, instructions, skills', highlight=True)
    d.box(335, 10, 240, 'Conversation run', 'Bounded execution attempt')
    d.box(620, 10, 240, 'Connection grants', 'Resources + permitted actions')
    d.box(265, 146, 350, 'Own Environment', 'Assigned to this agent', highlight=True)
    d.line('M 145 76 V 109 H 350 V 146', 'owns', 220, 98)
    d.line('M 455 76 V 146', 'claims', 493, 117)
    d.line('M 620 43 H 575')
    data=[(20,'Computer','Isolated sandbox or computer'),(335,'Working files','Persistent home and checkouts'),(620,'Private state','Browser, processes, scoped tools')]
    for x,a,b in data:
        d.box(x,294,250 if x==20 else 240,a,b)
        d.line(f'M 440 212 V 257 H {x+(125 if x==20 else 120)} V 294')
    d.note(440, 409, 'Pausing preserves files. Replacing compute does not replace agent identity.')
    return d.render('Different agents run in parallel on different computers. One active run per environment initially; saved artifacts live outside it.')


def artifacts():
    d = Diagram('artifacts', 335, 'From a local output to a reusable library artifact', 'Files are saved durably as one Artifact. Work links, the library, previews, downloads, and selected public shares reference the same immutable saved files. There is no artifact revision model.')
    d.box(20,10,250,'Generated file or upload','Computer-local until saved')
    d.box(335,10,240,'Durable upload','Bounded and retry-safe')
    d.box(620,10,240,'Artifact','One output + files + access',highlight=True)
    d.line('M 270 43 H 335')
    d.line('M 575 43 H 620')
    data=[(10,'Work links','Task and conversation'),(230,'Library','Search and filters'),(450,'Open output','Preview and download'),(670,'Public share','Selected saved files')]
    for x,a,b in data:
        d.box(x,188,200,a,b)
        d.line(f'M 740 76 V 132 H {x+100} V 188')
    d.note(440,304,'One artifact, many views. Stopping its computer does not remove the saved output.')
    return d.render('Documents hold editable knowledge; artifacts hold saved deliverables. Existing attachments can be promoted without storing the bytes twice.')


def sharing():
    d = Diagram('sharing', 375, 'One access model, two ways to share', 'Private documents or conversations can grant live access to authenticated invited collaborators, or a human can publish a selected snapshot as a read-only public link. Linked private records and excluded tool traces are not published.')
    d.box(15, 142, 255, 'Document / chat / artifact', 'Private source record', highlight=True)
    d.box(330, 25, 245, 'Invite participants', 'Grant access to live content')
    d.box(625, 25, 240, 'Authenticated people', 'View or collaborate')
    d.line('M 270 163 H 300 V 58 H 330')
    d.line('M 575 58 H 625')
    d.box(330, 170, 245, 'Human publish preview', 'Select content, messages, files')
    d.box(625, 170, 240, 'Published snapshot', 'Read-only public share link', highlight=True)
    d.line('M 270 185 H 330')
    d.line('M 575 203 H 625')
    d.box(625, 290, 240, 'Public reader', 'No live steering or private links')
    d.line('M 745 236 V 290')
    d.note(292, 309, 'Linked private records stay private.')
    d.note(292, 335, 'Revocation stops future link access.')
    return d.render('A session uses the conversation publishing flow. Changes to the live source do not silently update a public snapshot.')

def connections():
    d = Diagram('connections', 425, 'Connect once and assign scoped access', 'A human connects an account. The Connection manages authentication and grants access to an agent. A run requests a tool operation. Connections checks the caller, scope, policy, and account identity before resolving credentials and calling the provider. Saved results return to the conversation.')
    d.box(20,10,250,'Human connects account','One reusable connection')
    d.box(335,10,240,'Connection','Authentication + refresh',highlight=True)
    d.box(620,10,240,'Assign to agent','Resources + action grant')
    d.line('M 270 43 H 335')
    d.line('M 575 43 H 620')
    d.box(620,160,240,'Run requests operation','Tool call with caller identity')
    d.box(335,160,240,'Connection enforces access','Policy, account, credentials',highlight=True)
    d.box(20,160,250,'External provider','GitHub first')
    d.line('M 740 76 V 160')
    d.line('M 620 193 H 575')
    d.line('M 335 193 H 270')
    d.box(265,305,350,'Saved result','Message + run history + artifact',highlight=True)
    d.line('M 145 226 V 338 H 265')
    d.note(440,397,'Credential values stay out of conversation history and public shares.')
    return d.render('Connect once; assign separately to each agent. Writable actions use the connection policy and the selected account.')


def monorepo():
    d = Diagram('monorepo', 760, 'Separate apps, thin domain packages, shared infrastructure', 'The React web app calls one server. Thin packages own projects, tasks, conversations, documents, artifacts, agents, environments, sessions, runs, connections, and automations. They share one PostgreSQL database; pg-boss runs inside the server. Garage stores saved files, and one existing sandbox backend isolates agent computers.')
    d.box(125,10,285,'apps/web','React + Vite + shadcn',highlight=True)
    d.box(470,10,285,'apps/server','Auth + domain composition + live updates',highlight=True)
    d.line('M 410 43 H 470',both=True)
    d.box(220,122,440,'Thin domain packages','Schemas and functions; one backend',highlight=True)
    d.line('M 612 76 V 100 H 440 V 122')
    rows=[ [('projects','Membership + defaults'),('tasks','Owner + assignee + state'),('conversations','Members + messages'),('documents','Content + Collections + skills')], [('artifacts','Saved files + library'),('agents','Worker configuration'),('environments','Private computers'),('sessions','Continuing agent context')], [('runs','Attempts + ACP + recovery'),('connections','Accounts + tools + grants'),('automations','Prompt / script + pg-boss')] ]
    for row,entries in enumerate(rows):
        start=10 if len(entries)==4 else 120
        for i,(title,sub) in enumerate(entries): d.box(start+i*220,230+row*100,200,title,sub)
    d.note(440,535,'Packages are created when used. No service, command bus, or generic repository per domain.')
    d.box(20,590,250,'PostgreSQL','App records + pg-boss jobs')
    d.box(335,590,240,'Garage','Immutable saved files')
    d.box(620,590,240,'Sandbox backend','Private working state')
    d.line('M 220 155 H 0 V 623 H 20')
    d.line('M 660 155 H 878 V 623 H 860')
    d.line('M 878 555 H 455 V 590')
    d.note(440,720,'Two apps, one database, one storage service. The server starts and controls agent execution.')
    return d.render('Separate projects and tasks. Documents keep Collections and skills because they reuse content. All domains compose inside apps/server.')


def agent_fit():
    d = Diagram('agent-fit', 525, 'Agents, skills, connections, and launches', 'Skill Documents guide a reusable agent configuration. Assigned Connections supply permitted capabilities, including MCP tools. A manual action or automation starts one Run, using that agent configuration and its scoped environment. The existing harness or a script executes there; saved results go to conversations and the artifact library.')
    d.box(20,10,250,'Skill Documents','Instructions + supporting files')
    d.box(335,10,240,'Reusable agent','Instructions + harness + model',highlight=True)
    d.box(620,10,240,'Connections','MCP or provider adapter')
    d.line('M 270 43 H 335')
    d.line('M 620 43 H 575')
    d.box(20,155,250,'Manual action or Automation','When and what to run')
    d.box(335,155,240,'Run','One saved attempt',highlight=True)
    d.line('M 455 76 V 155')
    d.line('M 270 188 H 335')
    d.box(620,155,240,'Scoped environment','Own computer + working files')
    d.line('M 575 188 H 620')
    d.box(620,315,240,'Execution','Existing harness or script')
    d.line('M 740 221 V 315')
    d.box(265,315,310,'Saved outputs','Conversation + artifacts + history',highlight=True)
    d.line('M 620 348 H 575')
    d.note(440,449,'Skill = how. Connection = capability. Automation = launch. Run = attempt.')
    d.note(440,479,'Otto coordinates shared work around the existing coding harness.')
    return d.render('Skills and MCP add no extra profile model. Prompt and script execution reuse the same Run and isolation rules.')


def automations():
    d = Diagram('automations', 640, 'Manual and cron automations use the same run path', 'A manual action or cron tick selects a saved Automation. Current owner authorization, scope, and configuration version are checked. Run inputs and its pg-boss dispatch job are saved atomically. The server runtime claims the agent environment and launches either the existing prompt harness or a bounded script process. Saved outcomes, artifacts, and activity appear in the output conversation and run history.')
    d.box(20,10,250,'Manual Run','Explicit authorized action')
    d.box(335,10,240,'Automation','Owner + agent + content',highlight=True)
    d.box(620,10,240,'pg-boss cron','Schedule + named timezone')
    d.line('M 270 43 H 335')
    d.line('M 620 43 H 575')
    d.box(265,120,350,'Check current authorization','Owner, scope, current saved settings')
    d.line('M 455 76 V 120')
    d.box(265,230,350,'Save Run + pg-boss job','One attempt per request or occurrence',highlight=True)
    d.line('M 440 186 V 230')
    d.box(265,340,350,"Claim agent's environment",'The existing isolated execution path')
    d.line('M 440 296 V 340')
    d.box(20,450,250,'Prompt','Existing harness + skills')
    d.box(620,450,240,'Script','Code process; no LLM required')
    d.line('M 440 406 V 428 H 145 V 450')
    d.line('M 440 406 V 428 H 740 V 450')
    d.box(265,555,350,'Saved results + artifacts','Output conversation and run history',highlight=True)
    d.line('M 145 516 V 588 H 265')
    d.line('M 740 516 V 588 H 615')
    return d.render('pg-boss supplies manual jobs and cron inside the server. One Automation starts one ordinary Run.')


charts = {
    'relationships-without-nesting': relationships,
    'conversations-and-sessions': conversation,
    'data-flow': dataflow,
    'each-agent-gets-an-environment': environments,
    'artifacts-and-the-library': artifacts,
    'external-connections': connections,
    'how-agents-skills-connections-and-automations-fit': agent_fit,
    'automations-and-workflows': automations,
    'one-sharing-model': sharing,
    'internal-monorepo-and-stack': monorepo,
}
lines = md.splitlines()
rendered, sections = [], []
idx, in_section = 0, False
while idx < len(lines):
    line = lines[idx]
    if not line.strip() or line.startswith('# ') or line.startswith(('Revised draft,', 'Final plan,')):
        idx += 1
        continue
    if line.startswith('## '):
        if in_section: rendered.append('</section>')
        title = line[3:]
        anchor = slug(title)
        sections.append((anchor, title))
        rendered.append(f'<section class="section" id="{anchor}"><h2>{inline(title)}</h2>')
        in_section = True
        idx += 1
        continue
    if line.startswith('```'):
        language = line[3:].strip()
        idx += 1
        block = []
        while idx < len(lines) and not lines[idx].startswith('```'):
            block.append(lines[idx]); idx += 1
        idx += 1
        if language == 'mermaid':
            rendered.append(charts[sections[-1][0]]())
        else:
            rendered.append('<pre><code>' + escape('\n'.join(block)) + '</code></pre>')
        continue
    if line.startswith('|'):
        table = []
        while idx < len(lines) and lines[idx].startswith('|'):
            table.append([c.strip() for c in lines[idx].strip('|').split('|')]); idx += 1
        header, *rows = table
        rows = [r for r in rows if not all(re.fullmatch(r':?-+:?', c) for c in r)]
        rendered.append('<div class="table-wrap" tabindex="0" role="region" aria-label="' + escape(sections[-1][1], quote=True) + ' table"><table class="table"><thead><tr>' + ''.join('<th scope="col">' + inline(c) + '</th>' for c in header) + '</tr></thead><tbody>')
        for row in rows: rendered.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in row) + '</tr>')
        rendered.append('</tbody></table></div>')
        continue
    if line.startswith('- '):
        rendered.append('<ul>')
        while idx < len(lines) and lines[idx].startswith('- '):
            rendered.append('<li>' + inline(lines[idx][2:]) + '</li>'); idx += 1
        rendered.append('</ul>')
        continue
    if re.match(r'^\d+\. ', line):
        workflow = sections[-1][0] == 'working-with-the-least-friction'
        rendered.append('<ol class="steps">' if workflow else '<ol>')
        while idx < len(lines) and re.match(r'^\d+\. ', lines[idx]):
            text = re.sub(r'^\d+\. ', '', lines[idx])
            rendered.append('<li><div class="step-body">' + inline(text) + '</div></li>' if workflow else '<li>' + inline(text) + '</li>')
            idx += 1
        rendered.append('</ol>')
        continue
    paragraph = []
    while idx < len(lines) and lines[idx].strip() and not lines[idx].startswith(('## ', '- ', '|', '```')) and not re.match(r'^\d+\. ', lines[idx]):
        paragraph.append(lines[idx]); idx += 1
    rendered.append('<p>' + inline(' '.join(paragraph)) + '</p>')
if in_section: rendered.append('</section>')
content = '\n'.join(rendered)

navitems=[('scope-and-principles','Principles'),('our-models-replaceable-integrations','Models'),('naming','Naming'),('code-and-ui','Code and UI'),('secrets-shell-and-checks','Commands and checks')]
nav=''.join(f'<a href="#{a}">{t}</a>' for a,t in navitems)
header=f'<header class="page-header"><div class="row"><span class="badge badge-outline">Plan</span><span class="badge badge-info">Contributor guide</span></div><h1>Otto: code principles</h1><p class="lead">Our models, small domain adapters, clear naming, and the smallest correct change.</p><nav aria-label="Stack sections">{nav}</nav></header>'
footer='<footer class="page-footer"><span>1 October 2026 · Otto code principles</span></footer>'
html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Otto: code principles</title><style>'+css+'</style></head><body><main class="page">'+header+content+footer+'</main></body></html>'
(root/'otto-principles.html').write_text(html)
print(f'Stack canvas: {len(html.encode())} bytes; {len(sections)} sections')
