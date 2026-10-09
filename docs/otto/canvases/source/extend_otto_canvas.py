from pathlib import Path
import os
p=Path(os.environ['BB_THREAD_STORAGE'])/'canvas/build_otto_canvas.py'
s=p.read_text()
s=s.replace("Diagram('relationships', 540,", "Diagram('relationships', 900,")
s=s.replace("d.note(440, 525, 'Direct links connect original records. No parent task is needed.')\n    return d.render('Workspace documents and skills can be reused across projects. Runs and messages are supporting records inside the conversation.')", """d.box(15, 565, 220, 'Connection', 'Selected resources and actions')
    d.box(645, 565, 220, 'Own Environment', 'Computer + working files', highlight=True)
    d.box(330, 720, 220, 'Artifact', 'Saved output and revisions', highlight=True)
    d.box(645, 720, 220, 'Library view', 'Find and reuse artifacts')
    d.line('M 755 452 V 565', 'owns', 797, 518)
    d.line('M 550 440 H 605 V 598 H 645', 'executes in', 560, 545)
    d.line('M 235 598 H 565 V 565 H 645', 'scoped grants', 384, 583)
    d.line('M 440 452 V 720', 'produces', 485, 680)
    d.line('M 550 753 H 645', 'appears in', 597, 742)
    d.note(440, 851, 'Conversation is shared. Each agent owns its computer. Outputs are saved separately.')
    return d.render('Library is a view, not another primitive. Runs, computer references, and file revisions are supporting records.')""")
start=s.index('def dataflow():')
end=s.index('\ndef sharing():',start)
s=s[:start]+'''def dataflow():
    d = Diagram('dataflow', 780, 'Work, isolated execution, connections, and saved outputs', 'Authenticated internal commands save a run and pending work. The runner leases the agent environment and prepares authorized context. The agent executes in its own computer with scoped external connections, then saves durable artifacts and messages. Saved records stream back to people and agents.')
    d.box(275, 10, 330, 'People and agents', 'Actions, messages, directed requests')
    d.box(275, 110, 330, 'Internal domain commands', 'Authenticated web or runner calls', highlight=True)
    d.line('M 440 76 V 110')
    d.box(275, 210, 330, 'Atomic save', 'Run + pending work + history', highlight=True)
    d.line('M 440 176 V 210')
    d.box(30, 310, 250, 'Claim run + environment', 'One lease, no duplicate launch')
    d.line('M 350 276 V 294 H 155 V 310')
    d.box(30, 410, 250, 'Prepare context', 'Task, messages, skills, artifacts')
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
    d.box(620, 510, 230, 'External connections', 'GitHub first; scoped operations')
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
    data=[(20,'Computer','Dedicated VM or assigned device'),(335,'Working files','Persistent home and checkouts'),(620,'Private state','Browser, processes, scoped tools')]
    for x,a,b in data:
        d.box(x,294,250 if x==20 else 240,a,b)
        d.line(f'M 440 212 V 257 H {x+(125 if x==20 else 120)} V 294')
    d.note(440, 409, 'Pausing preserves files. Replacing compute does not replace agent identity.')
    return d.render('Different agents run in parallel on different computers. One active run per environment initially; saved artifacts live outside it.')


def artifacts():
    d = Diagram('artifacts', 335, 'From a local output to a reusable library artifact', 'Files from an agent computer or human upload are saved durably before publishing an artifact revision with provenance. Tasks, conversations, library views, previews, downloads, and explicit public shares reference that same revision. Library and collections do not copy output.')
    d.box(20,10,250,'Generated file or upload','Computer-local until saved')
    d.box(335,10,240,'Durable upload','Bounded and retry-safe')
    d.box(620,10,240,'Artifact revision','Files + provenance + access',highlight=True)
    d.line('M 270 43 H 335')
    d.line('M 575 43 H 620')
    data=[(10,'Work links','Task and conversation'),(230,'Library','Search and collections'),(450,'Open output','Preview and download'),(670,'Public share','Explicit revision snapshot')]
    for x,a,b in data:
        d.box(x,188,200,a,b)
        d.line(f'M 740 76 V 132 H {x+100} V 188')
    d.note(440,304,'One artifact, many views. Stopping its computer does not remove the saved output.')
    return d.render('Documents hold editable knowledge; artifacts hold saved deliverables. Existing attachments can be promoted without storing the bytes twice.')

''' + s[end:]
s=s.replace("'Document or conversation', 'Private source record'", "'Document / chat / artifact', 'Private source record'")
s=s.replace("'Select revision, messages, files'", "'Select revision, messages, files'")
s=s.replace("'Changes to the live source do not silently update a public snapshot.'", "'Changes to the live source do not silently update a public snapshot.'")
start=s.index('def monorepo():')
end=s.index('\ncharts =',start)
s=s[:start]+'''def monorepo():
    d = Diagram('monorepo', 650, 'One monorepo organized by domains', 'Web UI and the trusted runner call internal domain packages for work, conversations, documents, agents, environments, connections, artifacts, and sharing. Domains own their behavior. Storage holds shared records and durable files; agent computers hold isolated working files.')
    d.box(125,10,285,'apps/web','UI + server functions',highlight=True)
    d.box(470,10,285,'apps/runner','Trusted coordinator + adapters',highlight=True)
    d.box(220,122,440,'Internal domain packages','Exported commands and queries',highlight=True)
    for x in [267,612]: d.line(f'M {x} 76 V 100 H 440 V 122')
    data=[('work','Projects + flat tasks'),('conversations','Messages + participants'),('documents','Collections + skills'),('agents','Definitions + runs'),('environments','Computer + working files'),('connections','Provider access + grants'),('artifacts','Outputs + library'),('sharing','Access + publication')]
    for i,(a,b) in enumerate(data):
        x=10+(i%4)*220
        y=257+(i//4)*130
        d.box(x,y,200,a,b)
        if i<4: d.line(f'M 440 188 V 224 H {x+100} V {y}')
        else: d.line(f'M {x+100} 323 V {y}')
    d.box(190,535,500,'storage','Database + durable files + migrations')
    for i in range(4):
        x=110+i*220
        d.line(f'M {x} 453 V 495 H 440 V 535')
    d.note(440,632,'core: shared IDs and actor contracts · apps compose cross-domain work')
    return d.render('The domain rows list packages, not dependency edges between them. Environment volumes remain separate from durable artifact storage.')

''' + s[end:]
# The rows share a bus; they are siblings, not parent packages.
s=s.replace("else: d.line(f'M {x+100} 323 V {y}')", "else: d.line(f'M 440 188 H 870 V 354 H {x+100} V {y}')")
s=s.replace("    'data-flow': dataflow,", "    'data-flow': dataflow,\n    'each-agent-gets-an-environment': environments,\n    'artifacts-and-the-library': artifacts,")
s=s.replace("('data-flow', 'Data flow')", "('each-agent-gets-an-environment', 'Environments'), ('external-connections', 'Connections'), ('artifacts-and-the-library', 'Library'), ('data-flow', 'Data flow')")
s=s.replace('Six primitives · One sharing model · Internal domain packages','Nine primitives · Isolated agent computers · One sharing model')
s=s.replace('<p><strong>Clear responsibility.</strong>', '<p><strong>Each agent has its own computer.</strong> Environments hold working files. Connections grant external access. Saved artifacts appear in the library.</p><p><strong>Clear responsibility.</strong>')
p.write_text(s)
