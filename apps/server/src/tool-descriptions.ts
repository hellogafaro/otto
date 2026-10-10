export const toolDescriptions = {
  "chat.get":
    "Get the current Run's Chat metadata and Project association. Use this to establish the conversation's scope; it does not return messages or other Chats.",
  "chat.participants":
    "List current participants of this Run's Chat, including their roles. Returns a page of up to 100 items and a continuation cursor; use it to identify eligible collaborators, not to grant access.",
  "chat.read":
    "Read up to 100 published messages in the current Run's Chat after the numeric message cursor, in cursor order. Returns message content and attachment references; use file.read separately for authorized attachment bytes.",
  "message.get":
    "Get one published message by messageId within the current Run's Chat, including its content and attachment references. It cannot read a message from another Chat.",
  "message.create":
    "Publish a message to the current Run's Chat and return the saved message. Use it for discussion or an explicit handoff; replies must target this Chat, mentions must stay within the accepted and current audience, and attachments must be audience-readable workspace Files. Private File attachment requires the actual human custodian.",
  "run.get":
    "Get the current Run's record to inspect its state and accepted execution configuration. This does not select another Run or change its controls.",
  "run.list":
    "List authorized Runs in the current Run's Chat to inspect related execution. Returns a filtered and sorted page of up to 100 items with a continuation cursor; it does not search other Chats.",
  "run.activity":
    "Read up to 100 activity records for the current Run after a numeric activity cursor, in cursor order. Use this for execution progress and recorded events, not as a replacement for Chat messages.",
  "run.usage":
    "Get recorded model usage and cost estimates for the current Run. Totals can be unknown or incomplete; these records are not proof of provider billing or a final invoice.",
  "connection.get":
    "Get metadata for a Connection included in this Run's accepted grants. Use it to inspect the configured external account; it does not expose credentials or authorize an external operation.",
  "connection.list":
    "List metadata for the distinct Connections in this Run's accepted grants. Returns items with no continuation cursor; it is not a workspace-wide account search and does not reveal credentials.",
  "connection.request":
    "Request an external action against a granted Connection using its action, target and structured arguments. Current grants and operation policy determine whether it executes, awaits human confirmation or is denied. Returns the operation record and result; inspect its state, because denied, failed or uncertain outcomes are not success. Waiting for approval or execution is bounded to five minutes.",
  "schedule.get":
    "Get a Schedule by scheduleId only when its output Chat is the current Run's Chat. Returns its saved configuration; reading it does not enable it or launch a Run.",
  "schedule.list":
    "Discover authorized Schedules whose output Chat is the current Run's Chat. Returns a filtered and sorted page of up to 100 items with a continuation cursor; discovery does not enable a Schedule or launch a Run.",
  "schedule.history":
    "List execution history for a Schedule whose output Chat is the current Run's Chat. Returns a sorted page of up to 100 history records with a continuation cursor, not history for other destinations.",
  "project.get":
    "Get the Project associated with the current Run's Chat. Requires every accepted human to retain Project access; it does not accept an arbitrary Project ID.",
  "project.list":
    "Discover Projects within the Run's authorized discovery scope using the supplied filters and sort. Returns a page of up to 100 items with a continuation cursor; discovery does not grant membership or widen the accepted audience.",
  "project.members":
    "List current members and roles of the current Chat's Project. Returns a sorted page of up to 100 items with a continuation cursor; Project audience authorization still applies and listing members does not change membership.",
  "task.list":
    "Discover Tasks in the current Chat's Project using the supplied query, status, archive, owner and assignee filters. Returns a sorted page of up to 100 items with a continuation cursor. Status values backlog/todo/doing/review/done mean Backlog/Pending/In progress/In review/Completed; discovery does not grant write access.",
  "task.get":
    "Get a Task in the current Chat's Project. For this Run's associated Task, returns the immutable accepted Task context; for another authorized Task, returns its current record. Use the returned editToken for fenced edits and do not assume accepted context is the latest state.",
  "task.create":
    "Create a new Task with title and notes in the current Chat's Project, owned by the Run's human sponsor. Returns the saved Task and announces its creation in this Chat. The Project audience must fit the accepted Run audience; this is new creation, not an update or duplicate lookup.",
  "task.capture":
    "Capture a message from the current Chat as a Task in that Chat's Project, with the supplied title and the human sponsor as owner. Returns the saved Task and announces its creation in this Chat. Use this when the message is the source of the work; message and Project audience authorization still apply.",
  "task.update":
    "Edit allowed Task fields in the current Chat's Project using the expected editToken; returns the updated Task. Ordinary edits execute as the Agent under current writer and audience checks. Including ownerId or either assignee list requests human approval of the entire exact payload before any field changes; a denied request is not success.",
  "task.status":
    "Change a Task's workflow status using its expected editToken and return the updated Task. Backlog, Pending and In progress correspond to backlog, todo and doing. Completed (done) requires approval and execution by the actual authorized human; a denied request is not completion. Submit In review through task_proposeCompletion, not this tool. A Task already In review must use the human review action to approve or request changes.",
  "task.proposeCompletion":
    "Submit a Task in the current Chat's Project for human review using taskId, the current editToken and an evidence/handoff body. Moves it to In review (review), saves the review evidence as an immutable Task comment and posts the handoff to the current Chat. Project readers must match the accepted human audience. This does not mark the Task Completed; only an authorized human can approve completion or request changes.",
  "task.links":
    "List a Task's links within the current Chat's Project, returning a sorted page of up to 100 items with a continuation cursor. Linked Files and Documents must be readable by the accepted audience, and a Chat link must reference the current Chat; the call does not fetch URL contents.",
  "task.link.create":
    "Add a document, file, current-Chat or HTTP(S) URL reference to a Task in the current Chat's Project. Returns the Task ID, link type and reference; it does not copy bytes or fetch the URL. Requires writer access, matching Run/Project audience and authorization for the linked resource; URLs cannot contain credentials.",
  "task.link.delete":
    "Remove the specified linkId from a Task in the current Chat's Project and return both IDs. Requires current Task writer access and matching Run/Project audience; it does not delete the linked resource.",
  "task.comment.create":
    "Add a discussion or evidence comment to a Task in the current Chat's Project and return the saved comment. Requires Task writer access and matching Run/Project audience; this does not publish a Chat message or submit a completion review.",
  "task.comment.get":
    "Get one comment by commentId after verifying its Task belongs to the current Chat's Project. Returns the saved comment; it cannot read comments from another Project.",
  "task.comment.list":
    "List comments on a Task in the current Chat's Project. Returns a sorted page of up to 100 comments with a continuation cursor; use this to inspect discussion or review evidence without changing it.",
  "task.comment.update":
    "Replace the body of a comment authored by this Agent on a Task in the current Chat's Project and return the updated comment. Requires current Task writer access and matching Run/Project audience; another author's comments and immutable review summaries cannot be edited.",
  "task.comment.delete":
    "Delete a comment authored by this Agent on a Task in the current Chat's Project and return its commentId. Requires current Task writer access and matching Run/Project audience; another author's comments and immutable review summaries cannot be deleted.",
  "time.get":
    "Get one manual Timesheet entry whose Task belongs to the current Chat's Project. Returns logged whole-minute duration, notes and creator metadata; this is human-entered time, not Agent runtime or billing.",
  "time.list":
    "List manual Timesheet entries for a Task in the current Chat's Project, optionally filtered by creator. Returns a sorted page of up to 100 entries with a continuation cursor; durations are whole minutes, not model execution time. Reading time does not permit edits to another human's entries.",
  "document.list":
    "Discover workspace-visible Documents in the current Chat's Project using query, archive, label and Collection filters. Returns a sorted page of up to 100 items with a continuation cursor; it does not discover private Documents or return File bytes.",
  "document.get":
    "Read an authorized Document selected in this Run's accepted context or belonging to the current Chat's Project. Returns accepted title/body for a selected Document, otherwise its current record; every accepted human must retain access. This does not apply proposed edits.",
  "document.proposeChange":
    "Save a proposed replacement title and body for an accepted or current-Project Document and return the proposal record. The editToken must match the accepted source or current Document, and the publication audience must match the Run audience. The saved Document is unchanged until an authorized human accepts the proposal.",
  "collection.get":
    "Get a Collection's metadata and field configuration within the current Chat's Project. Use document.list with collectionId to find its Documents; this call does not return all Collection content.",
  "collection.list":
    "Discover Collections within the current Chat's Project using query and archive filters. Returns a sorted page of up to 100 items with a continuation cursor; it does not list their Documents.",
  "file.get":
    "Get saved File metadata by fileId after current access and accepted-audience checks. Use this to inspect type, size and saved source before reading; it does not return bytes or broaden File visibility.",
  "file.list":
    "Discover workspace-visible Files in the current Chat's Project using query, type, archive and label filters. Returns a sorted page of up to 100 metadata records with a continuation cursor; each File must be readable by the accepted audience. Use file.read separately for bytes.",
  "file.read":
    "Read verified saved File bytes as base64, limited to 8 MiB per File. Requires configured File storage, current access and accepted-audience authorization, rechecked after I/O. This does not read host paths, download arbitrary URLs or support large File streaming.",
  "file.create":
    "Save a generated text/plain, Markdown, HTML or JSON File from at most 64,000 text characters and return its saved metadata. Requires configured File storage; visibility and optional Project placement must satisfy current authority and source-Run audience checks. This creates stored bytes, not a host file, arbitrary binary upload or internet publication.",
  "skill.list":
    "List authorized Skills with query and archive filters, returning a sorted page of up to 100 items with a continuation cursor. Every returned Skill must already be accepted for this Run and readable by its human audience; a page containing an unaccepted Skill is rejected rather than silently expanded. Use skill.get for accepted instructions.",
  "skill.get":
    "Get the accepted title and instructions of a Skill selected for this Run. Current Skill and audience access are still checked; this does not discover or attach additional Skills.",
  "skill.export":
    "Export an accepted Skill as skillMd text and supporting-file references. The current Skill editToken must still match the accepted source and its files must be readable by the Run audience. This does not install the Skill or execute its scripts.",
  "skill.read":
    "Read a supporting file at an exact path in an accepted Skill's immutable file references and return verified bytes as base64, limited to 8 MiB. Requires configured File storage and source/audience authorization before and after I/O. It does not access a host directory or execute the file.",
  "skill.proposeChange":
    "Save a proposed replacement title and instructions for a Skill accepted by this Run and return the proposal record. Requires the accepted editToken, current access and matching publication audience. The Skill itself remains unchanged until an authorized human accepts the proposal.",
  "human.ask":
    "Ask the Run's human a question and wait up to five minutes for an answer, returning the answer text. Use this for missing information or a decision; an answer is not execution approval for a separate native action or Connection operation. Timeout or cancellation is not an answer.",
  "agent.request":
    "Request a peer Run from an authorized Agent in the current Chat using the supplied body. Returns runId and acknowledged, not the peer's finished answer. Current membership, source audience and authorized model-account checks apply, with at most eight children per Run, three handoff levels and thirty peer admissions per workspace per minute; this does not provision an isolated computer.",
} as const;

export const nativeActionDescriptions = {
  "document.proposal.resolve":
    "Accept or reject a saved Document change proposal against the current editToken; acceptance applies its content.",
  "skill.proposal.resolve":
    "Accept or reject a saved Skill change proposal against the current editToken; acceptance applies its instructions.",
  "schedule.run":
    "Admit a manual prompt Run from a Schedule under its current configuration and model authorization; returns a Run reference, not completed output. Computer execution is unavailable.",
  "project.create":
    "Create a Project with a title and optional repository URL; saving a URL does not clone or execute a repository.",
  "project.update":
    "Edit a Project's title or repository URL without changing membership.",
  "project.archive":
    "Archive or restore a Project; archive blocks new admission without implicitly stopping active Runs.",
  "project.member.upsert":
    "Add a human Project member or update an existing member's viewer/contributor role.",
  "project.member.update":
    "Change an existing human Project member's viewer/contributor role; this does not create a membership.",
  "project.member.delete":
    "Remove a human's Project membership; current resource authorization is rechecked independently.",
  "document.create":
    "Create an editable Document with content, visibility and optional Project/Folder placement; this is not a File upload.",
  "document.update":
    "Edit a Document's content or allowed metadata against its editToken, with placement and attachment-audience checks for visibility changes.",
  "document.archive":
    "Archive or restore a Document against its current editToken; this does not erase its saved content.",
  "document.collection":
    "Set a Document's Collection and typed property values against its editToken.",
  "document.attachments":
    "Replace a Document's File attachment selection against its editToken; each File must be readable by the Document audience.",
  "collection.create":
    "Create a Collection with typed fields and optional Project scope; this does not create its Documents.",
  "collection.update":
    "Edit a Collection's title, fields or table/list presentation against its editToken.",
  "collection.archive":
    "Archive or restore a Collection against its editToken; this does not delete its Documents.",
  "folder.create":
    "Create a Library Folder with visibility and optional Project/parent placement, within the maximum nesting depth of eight.",
  "folder.update":
    "Edit a Folder's title, visibility or parent placement without copying item bytes or changing item visibility.",
  "folder.archive":
    "Archive or restore a Folder; only an empty Folder can be archived.",
  "task.status":
    "Mark a Task Completed (done) as the authorized human against its editToken; the Agent cannot complete it independently.",
  "task.review":
    "Approve submitted Task work as Completed or request changes, recording the human review comment and the originating Chat/Agent handoff.",
  "task.update":
    "Apply the exact Task edit payload, including any owner or assignee changes, as the authorized human against its editToken.",
  "task.archive":
    "Archive or restore a Task against its editToken; archive blocks new admission without implicitly stopping active Runs.",
  "timesheet.create":
    "Log the approving human's manual time on a writable Task as positive whole minutes, not Agent runtime.",
  "timesheet.update":
    "Edit the approving human's own manual time duration or notes with current Task writer access; another human's entries are not editable.",
  "timesheet.delete":
    "Delete the approving human's own manual time entry with current Task writer access; another human's entries are not deletable.",
  "file.update":
    "Edit a saved File's title, labels, visibility or Folder placement under custodian and source-audience checks; stored bytes are unchanged.",
  "file.archive":
    "Archive or restore saved File metadata; this does not replace its immutable bytes.",
  "agent.create":
    "Create reusable Agent configuration with instructions, an explicit model/account selection, visibility and selected Skills; this does not launch it.",
  "agent.update":
    "Edit allowed Agent configuration against its editToken; changing Skills or model selection does not rewrite accepted Run snapshots.",
  "agent.archive":
    "Archive or restore an Agent against its editToken; archive blocks new admission without implicitly stopping active Runs.",
  "skill.create":
    "Create a reusable Skill with instructions, when-to-use guidance and visibility; this does not attach it to an Agent or execute it.",
  "skill.update":
    "Edit a Skill's instructions, guidance or allowed metadata against its editToken; accepted Run snapshots remain immutable.",
  "skill.archive":
    "Archive or restore a Skill against its editToken without executing its supporting files.",
  "skill.import":
    "Import a Skill from SKILL.md text with explicit visibility and optional Project scope; this does not execute its content.",
  "skill.files":
    "Replace a Skill's supporting-file references under scripts/, references/ or assets/ against its editToken, with File audience checks; no host-folder access or script execution occurs.",
  "chat.create":
    "Create a Chat with workspace or participants visibility and optional Project scope; this does not automatically share private dependencies.",
  "chat.update":
    "Change a Chat's title under current creator and writer authority without changing participants.",
  "chat.archive":
    "Archive or restore a Chat under current metadata authority; archive does not implicitly stop active Runs.",
  "chat.participant.create":
    "Add one human or Agent as a Chat viewer or contributor under creator and Project authority; Agents still require explicit membership.",
  "chat.participant.update":
    "Change an existing Chat participant's viewer/contributor role under current participant-management authority.",
  "chat.participant.delete":
    "Remove a Chat participant under current participant-management authority; participant-dependent reads and controls remain subject to revocation checks.",
  "connection.create":
    "Create GitHub or remote MCP Connection metadata for an account reference and visibility; this does not supply credentials or authorize Agent operations.",
  "connection.update":
    "Edit a Connection's title or policy against its editToken; title-only edits preserve grants, while real policy changes retain their fence.",
  "connection.disconnect":
    "Disconnect a Connection against its editToken, revoking its execution availability without exposing credentials.",
  "connection.activate":
    "Activate a configured remote MCP Connection under its creator's current authority. GitHub requires human credential completion; activation needs the configured Connection service and does not run local MCP commands.",
  "connection.grant":
    "Set one Agent's Connection grant with an audience, resources and allowed/confirmation/disabled operation policies against the Connection editToken; this is explicit execution authority, not visibility alone.",
  "connection.revoke":
    "Revoke an Agent's Connection grant against the Connection editToken, removing that external execution authority.",
  "schedule.create":
    "Create a reusable prompt Schedule with an Agent, output Chat, timezone, optional cron/Task and explicit lifecycle status; enabled cron configuration can admit future Runs.",
  "schedule.update":
    "Edit allowed Schedule configuration or ownership against its editToken; changes fence earlier queued configuration without implicitly stopping active Runs.",
} as const;
