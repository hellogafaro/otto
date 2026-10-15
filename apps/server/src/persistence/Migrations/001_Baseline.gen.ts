import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Otto: The whole schema in one migration, generated from the database the former 88
 * migrations produced. Schema changes are numbered migrations after it until MVP, when
 * they are folded back in here.
 */
const statements = [
  `
    CREATE TABLE orchestration_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_kind TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        stream_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        command_id TEXT,
        causation_event_id TEXT,
        correlation_id TEXT,
        actor_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX idx_orch_events_stream_version
      ON orchestration_events(aggregate_kind, stream_id, stream_version)
  `,
  `
    CREATE INDEX idx_orch_events_stream_sequence
      ON orchestration_events(aggregate_kind, stream_id, sequence)
  `,
  `
    CREATE INDEX idx_orch_events_command_id
      ON orchestration_events(command_id)
  `,
  `
    CREATE INDEX idx_orch_events_correlation_id
      ON orchestration_events(correlation_id)
  `,
  `
    CREATE TABLE orchestration_command_receipts (
        command_id TEXT PRIMARY KEY,
        aggregate_kind TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        result_sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT
    )
  `,
  `
    CREATE INDEX idx_orch_command_receipts_aggregate
      ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  `,
  `
    CREATE INDEX idx_orch_command_receipts_sequence
      ON orchestration_command_receipts(result_sequence)
  `,
  `
    CREATE TABLE checkpoint_diff_blobs (
        thread_id TEXT NOT NULL,
        from_turn_count INTEGER NOT NULL,
        to_turn_count INTEGER NOT NULL,
        diff TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (thread_id, from_turn_count, to_turn_count)
    )
  `,
  `
    CREATE INDEX idx_checkpoint_diff_blobs_thread_to_turn
      ON checkpoint_diff_blobs(thread_id, to_turn_count)
  `,
  `
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT,
      provider_instance_id TEXT
    )
  `,
  `
    CREATE INDEX idx_provider_session_runtime_status
      ON provider_session_runtime(status)
  `,
  `
    CREATE INDEX idx_provider_session_runtime_provider
      ON provider_session_runtime(provider_name)
  `,
  `
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      default_model_selection_json TEXT,
      default_thread_env_mode TEXT,
      favicon_path TEXT,
      description TEXT,
      owner_json TEXT,
      resources_json TEXT,
      status TEXT
    )
  `,
  `
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      model_selection_json TEXT,
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER NOT NULL DEFAULT 0,
      pending_user_input_count INTEGER NOT NULL DEFAULT 0,
      has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
      settled_override TEXT,
      settled_at TEXT,
      snoozed_until TEXT,
      snoozed_at TEXT,
      title_regeneration_request_id TEXT,
      title_regeneration_started_at TEXT,
      pinned_at TEXT,
      pin_order_key TEXT,
      linked_pull_request_json TEXT,
      unsettled_at TEXT,
      bot_id TEXT,
      group_id TEXT,
      responding_bot_id TEXT,
      parent_thread_id TEXT,
      parent_delegation_id TEXT,
      created_by TEXT,
      visibility TEXT NOT NULL DEFAULT 'organization'
    )
  `,
  `
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attachments_json TEXT,
      responding_bot_id TEXT,
      reactions_json TEXT NOT NULL DEFAULT '[]',
      author_person_id TEXT,
      author_display_name TEXT,
      channel_origin_json TEXT,
      channel_delivery TEXT
    )
  `,
  `
    CREATE TABLE projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sequence INTEGER
    )
  `,
  `
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider_name TEXT,
      provider_session_id TEXT,
      provider_thread_id TEXT,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      provider_instance_id TEXT,
      mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'
    )
  `,
  `
    CREATE TABLE projection_turns (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        pending_message_id TEXT,
        assistant_message_id TEXT,
        state TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        checkpoint_turn_count INTEGER,
        checkpoint_ref TEXT,
        checkpoint_status TEXT,
        checkpoint_files_json TEXT NOT NULL,
        source_proposed_plan_thread_id TEXT,
        source_proposed_plan_id TEXT,
        responding_bot_id TEXT,
        UNIQUE (thread_id, turn_id),
        UNIQUE (thread_id, checkpoint_turn_count)
    )
  `,
  `
    CREATE TABLE projection_pending_approvals (
        request_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        status TEXT NOT NULL,
        decision TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
    )
  `,
  `
    CREATE TABLE projection_state (
        projector TEXT PRIMARY KEY,
        last_applied_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX idx_projection_projects_updated_at
      ON projection_projects(updated_at)
  `,
  `
    CREATE INDEX idx_projection_threads_project_id
      ON projection_threads(project_id)
  `,
  `
    CREATE INDEX idx_projection_thread_messages_thread_created
      ON projection_thread_messages(thread_id, created_at)
  `,
  `
    CREATE INDEX idx_projection_thread_activities_thread_created
      ON projection_thread_activities(thread_id, created_at)
  `,
  `
    CREATE INDEX idx_projection_thread_sessions_provider_session
      ON projection_thread_sessions(provider_session_id)
  `,
  `
    CREATE INDEX idx_projection_turns_thread_requested
      ON projection_turns(thread_id, requested_at)
  `,
  `
    CREATE INDEX idx_projection_turns_thread_checkpoint_completed
      ON projection_turns(thread_id, checkpoint_turn_count, completed_at)
  `,
  `
    CREATE INDEX idx_projection_pending_approvals_thread_status
      ON projection_pending_approvals(thread_id, status)
  `,
  `
    CREATE INDEX idx_projection_thread_activities_thread_sequence
      ON projection_thread_activities(thread_id, sequence)
  `,
  `
    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      implemented_at TEXT,
      implementation_thread_id TEXT
    )
  `,
  `
    CREATE INDEX idx_projection_thread_proposed_plans_thread_created
      ON projection_thread_proposed_plans(thread_id, created_at)
  `,
  `
    CREATE INDEX idx_projection_threads_project_archived_at
      ON projection_threads(project_id, archived_at)
  `,
  `
    CREATE INDEX idx_projection_projects_workspace_root_deleted_at
      ON projection_projects(workspace_root, deleted_at)
  `,
  `
    CREATE INDEX idx_projection_threads_project_deleted_created
      ON projection_threads(project_id, deleted_at, created_at)
  `,
  `
    CREATE INDEX idx_provider_session_runtime_instance
      ON provider_session_runtime(provider_instance_id)
  `,
  `
    CREATE INDEX idx_projection_thread_sessions_instance
      ON projection_thread_sessions(provider_instance_id)
  `,
  `
    CREATE INDEX idx_projection_thread_activities_thread_sequence_created_id
      ON projection_thread_activities(thread_id, sequence, created_at, activity_id)
  `,
  `
    CREATE INDEX idx_projection_thread_messages_thread_created_id
      ON projection_thread_messages(thread_id, created_at, message_id)
  `,
  `
    CREATE INDEX idx_projection_threads_shell_active
      ON projection_threads(deleted_at, archived_at, project_id, created_at, thread_id)
  `,
  `
    CREATE INDEX idx_projection_threads_shell_archived
      ON projection_threads(deleted_at, archived_at, project_id, thread_id)
  `,
  `
    CREATE TABLE auth_pairing_links (
      id TEXT PRIMARY KEY,
      credential TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      scopes TEXT NOT NULL,
      subject TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      proof_key_thumbprint TEXT
    )
  `,
  `
    CREATE INDEX idx_auth_pairing_links_active
      ON auth_pairing_links(revoked_at, consumed_at, expires_at)
  `,
  `
    CREATE TABLE auth_sessions (
      session_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      scopes TEXT NOT NULL,
      method TEXT NOT NULL,
      client_label TEXT,
      client_ip_address TEXT,
      client_user_agent TEXT,
      client_device_type TEXT NOT NULL DEFAULT 'unknown',
      client_os TEXT,
      client_browser TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_connected_at TEXT,
      revoked_at TEXT,
      client_surface TEXT,
      client_app_version TEXT
    )
  `,
  `
    CREATE INDEX idx_auth_sessions_active
      ON auth_sessions(revoked_at, expires_at, issued_at)
  `,
  `
    CREATE INDEX idx_projection_turns_thread_keyset
      ON projection_turns(thread_id, requested_at, turn_id)
  `,
  `
    CREATE TABLE projection_groups (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      boss_bot_id TEXT,
      members_json TEXT NOT NULL DEFAULT '[]'
    )
  `,
  `
    CREATE TABLE projection_bots (
      bot_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      avatar_json TEXT NOT NULL,
      engine_json TEXT,
      sandbox TEXT,
      group_id TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      usage_cap_json TEXT,
      label TEXT,
      description TEXT,
      disabled_mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
      voice_enabled INTEGER NOT NULL DEFAULT 0,
      channel_bindings_json TEXT NOT NULL DEFAULT '[]',
      personality_tone INTEGER NOT NULL DEFAULT 50 CHECK (personality_tone BETWEEN 0 AND 100),
      image_provider TEXT,
      owner_json TEXT,
      disabled_skill_ids_json TEXT NOT NULL DEFAULT '[]'
    )
  `,
  `
    CREATE INDEX idx_projection_bots_group_id
      ON projection_bots(group_id)
  `,
  `
    CREATE INDEX idx_projection_bots_archived_at
      ON projection_bots(archived_at)
  `,
  `
    CREATE INDEX idx_projection_threads_bot_id
      ON projection_threads(bot_id)
  `,
  `
    CREATE INDEX idx_projection_threads_group_id
      ON projection_threads(group_id)
  `,
  `
    CREATE TABLE projection_mcp_servers (
        mcp_server_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'url')),
        command TEXT,
        args_json TEXT,
        url TEXT,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        instructions TEXT,
        visibility TEXT NOT NULL DEFAULT 'organization',
        created_by_json TEXT,
        CHECK (
          (transport = 'stdio' AND command IS NOT NULL AND url IS NULL) OR
          (transport = 'url' AND command IS NULL AND args_json IS NULL AND url IS NOT NULL)
        )
    )
  `,
  `
    CREATE INDEX idx_projection_mcp_servers_created_at
      ON projection_mcp_servers(created_at, mcp_server_id)
  `,
  `
    CREATE TABLE otto_memory_revisions (
        memory_id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        tenant_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (
          scope IN ('user', 'bot-user', 'bot', 'project', 'group', 'workspace', 'thread')
        ),
        partition_id TEXT NOT NULL,
        entity_kind TEXT NOT NULL CHECK (
          entity_kind IN ('user', 'bot', 'person', 'project', 'group', 'workspace', 'other')
        ),
        entity_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('fact', 'preference', 'identity', 'relationship', 'routine', 'instruction')
        ),
        value_json TEXT NOT NULL,
        fact_text TEXT NOT NULL CHECK (length(trim(fact_text)) > 0),
        source_thread_id TEXT,
        source_message_id TEXT,
        author_bot_id TEXT,
        initiating_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        updated_at TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        approval_state TEXT NOT NULL CHECK (approval_state IN ('pending', 'approved', 'rejected')),
        supersedes_id TEXT REFERENCES otto_memory_revisions(memory_id),
        superseded_by_id TEXT,
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
        deletion_state TEXT NOT NULL CHECK (deletion_state IN ('active', 'tombstoned', 'deleted')),
        pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
        sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
        affected_bot_ids_json TEXT NOT NULL,
        UNIQUE (tenant_id, root_id, revision)
    )
  `,
  `
    CREATE INDEX idx_otto_memory_partition_current
      ON otto_memory_revisions (
        tenant_id,
        scope,
        partition_id,
        approval_state,
        deletion_state,
        superseded_by_id
    )
  `,
  `
    CREATE INDEX idx_otto_memory_entity_current
      ON otto_memory_revisions (tenant_id, entity_kind, entity_id, superseded_by_id)
  `,
  `
    CREATE UNIQUE INDEX idx_otto_memory_one_current_revision
      ON otto_memory_revisions (tenant_id, root_id)
      WHERE superseded_by_id IS NULL
  `,
  `
    CREATE INDEX idx_otto_memory_source_thread
      ON otto_memory_revisions (source_thread_id)
  `,
  `
    CREATE TABLE otto_memory_derived_copies (
        tenant_id TEXT NOT NULL,
        root_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, root_id, thread_id)
    )
  `,
  `
    CREATE INDEX idx_otto_memory_derived_copies_thread
      ON otto_memory_derived_copies (thread_id)
  `,
  `
    CREATE VIRTUAL TABLE otto_memory_fts USING fts5(
        memory_id UNINDEXED,
        fact_text,
        tokenize = 'unicode61 remove_diacritics 2'
    )
  `,
  `
    CREATE TRIGGER otto_memory_fts_insert
      AFTER INSERT ON otto_memory_revisions
      WHEN NEW.approval_state = 'approved'
        AND NEW.deletion_state = 'active'
        AND NEW.superseded_by_id IS NULL
      BEGIN
        INSERT INTO otto_memory_fts(memory_id, fact_text)
        VALUES (NEW.memory_id, NEW.fact_text);
    END
  `,
  `
    CREATE TRIGGER otto_memory_fts_update
      AFTER UPDATE ON otto_memory_revisions
      BEGIN
        DELETE FROM otto_memory_fts WHERE memory_id = OLD.memory_id;
        INSERT INTO otto_memory_fts(memory_id, fact_text)
        SELECT NEW.memory_id, NEW.fact_text
        WHERE NEW.approval_state = 'approved'
          AND NEW.deletion_state = 'active'
          AND NEW.superseded_by_id IS NULL;
    END
  `,
  `
    CREATE TRIGGER otto_memory_fts_delete
      AFTER DELETE ON otto_memory_revisions
      BEGIN
        DELETE FROM otto_memory_fts WHERE memory_id = OLD.memory_id;
    END
  `,
  `
    CREATE TABLE otto_memory_candidates (
      candidate_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      initiating_user_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      source_message_id TEXT,
      author_bot_id TEXT,
      fact_text TEXT NOT NULL CHECK (length(trim(fact_text)) > 0),
      target_scope TEXT NOT NULL CHECK (
        target_scope IN ('private', 'bot', 'project', 'group', 'workspace')
      ),
      sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      affected_bot_ids_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_memory_root_id TEXT,
      pending_update_json TEXT
    )
  `,
  `
    CREATE INDEX idx_otto_memory_candidates_thread_status
      ON otto_memory_candidates (tenant_id, source_thread_id, status, created_at)
  `,
  `
    CREATE TABLE otto_memory_decision_receipts (
        receipt_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES otto_memory_candidates(candidate_id),
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
        fact_text TEXT NOT NULL,
        target_scope TEXT NOT NULL,
        affected_bot_ids_json TEXT NOT NULL,
        memory_root_id TEXT,
        created_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX idx_otto_memory_candidate_one_decision
      ON otto_memory_decision_receipts (tenant_id, candidate_id)
  `,
  `
    CREATE TABLE otto_bot_usage_balances (
        bot_id TEXT PRIMARY KEY,
        consumed_tokens INTEGER NOT NULL DEFAULT 0 CHECK (consumed_tokens >= 0),
        reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
        updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE otto_bot_usage_entries (
        reservation_id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        category TEXT NOT NULL,
        state TEXT NOT NULL,
        reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
        held_tokens INTEGER NOT NULL DEFAULT 0 CHECK (held_tokens >= 0),
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        provider TEXT,
        model TEXT,
        unavailable_reason TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
        CHECK (category IN ('turn', 'tool', 'observer', 'reflector', 'extraction', 'recall', 'routine', 'delegated')),
        CHECK (state IN ('reserved', 'reported', 'unavailable', 'released')),
        UNIQUE (bot_id, source_key)
    )
  `,
  `
    CREATE INDEX idx_otto_bot_usage_entries_bot_created
      ON otto_bot_usage_entries (bot_id, created_at DESC)
  `,
  `
    CREATE INDEX idx_otto_bot_usage_entries_thread_turn
      ON otto_bot_usage_entries (thread_id, turn_id)
  `,
  `
    CREATE UNIQUE INDEX idx_otto_bot_usage_entries_bound_turn
      ON otto_bot_usage_entries (bot_id, thread_id, turn_id)
      WHERE category = 'turn' AND turn_id IS NOT NULL
  `,
  `
    CREATE TABLE projection_delegations (
        delegation_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE projection_routines (
      routine_id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      job TEXT NOT NULL,
      procedure TEXT NOT NULL,
      procedure_version INTEGER NOT NULL,
      approval_version INTEGER,
      schedule_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      skill_assignment_ids_json TEXT NOT NULL DEFAULT '[]',
      connector_dependencies_json TEXT NOT NULL DEFAULT '[]',
      sandbox TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      lifecycle TEXT NOT NULL CHECK (
        lifecycle IN (
          'draft', 'approved', 'enabled', 'running', 'paused', 'blocked', 'failed',
          'completed', 'deleted'
    )
      ),
      next_run_at TEXT,
      last_run_at TEXT,
      latest_result_json TEXT,
      latest_failure_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      delegate_to_bot_id TEXT,
      thread_mode TEXT NOT NULL DEFAULT 'target',
      created_by TEXT,
      visibility TEXT NOT NULL DEFAULT 'organization'
    )
  `,
  `
    CREATE INDEX idx_projection_routines_due
      ON projection_routines(enabled, next_run_at)
  `,
  `
    CREATE TABLE projection_routine_runs (
        run_id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        procedure_version INTEGER NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('dry-run', 'manual', 'scheduled', 'missed')),
        scheduled_for TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'queued', 'running', 'waiting-for-approval', 'completed', 'failed', 'canceled', 'blocked'
    )
        ),
        thread_ref TEXT,
        result_json TEXT,
        failure_json TEXT,
        usage_ref TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (routine_id, scheduled_for)
    )
  `,
  `
    CREATE INDEX idx_projection_routine_runs_history
      ON projection_routine_runs(routine_id, scheduled_for DESC)
  `,
  `
    CREATE TABLE projection_routine_skill_assignments (
        assignment_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE channel_deliveries (
        message_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (
          provider IN ('telegram', 'imessage', 'whatsapp', 'slack', 'discord')
        ),
        external_thread_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('requested', 'sent')),
        requested_at TEXT NOT NULL,
        sent_at TEXT
    )
  `,
  `
    CREATE INDEX idx_channel_deliveries_bot_provider
      ON channel_deliveries (bot_id, provider, status)
  `,
  `
    CREATE INDEX idx_projection_thread_activities_user_input_lifecycle
      ON projection_thread_activities(thread_id, turn_id, kind, sequence, created_at, activity_id)
  `,
  `
    CREATE TABLE "routine_run_claims" (
        run_id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('dry-run', 'manual', 'scheduled', 'missed')),
        scheduled_for TEXT,
        status TEXT NOT NULL CHECK (status IN ('claimed', 'dispatched', 'completed', 'failed', 'canceled', 'blocked')),
        thread_id TEXT,
        failure TEXT,
        claimed_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (routine_id, scheduled_for)
    )
  `,
  `
    CREATE TABLE projection_tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        owner_json TEXT,
        assignees_json TEXT NOT NULL,
        resources_json TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX idx_projection_tasks_project
      ON projection_tasks(project_id, updated_at)
  `,
  `
    CREATE TABLE projection_timesheets (
        entry_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX idx_projection_timesheets_task
      ON projection_timesheets(task_id, created_at)
  `,
  `
    CREATE TABLE projection_library_folders (
      folder_id TEXT PRIMARY KEY,
      parent_id TEXT,
      thread_id TEXT,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      project_id TEXT
    )
  `,
  `
    CREATE INDEX idx_projection_library_folders_parent
      ON projection_library_folders(parent_id)
  `,
  `
    CREATE TABLE projection_library_files (
        file_id TEXT PRIMARY KEY,
        folder_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        extension TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        visibility TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_by_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX idx_projection_library_files_folder
      ON projection_library_files(folder_id)
  `,
  `
    CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_type TEXT,
        actor_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT
    )
  `,
  `
    CREATE INDEX idx_activity_entity
      ON activity(entity_type, entity_id, created_at)
  `,
  `
    CREATE TABLE composio_accounts (
      connection_id TEXT PRIMARY KEY,
      created_by TEXT,
      created_by_name TEXT,
      visibility TEXT NOT NULL,
      created_at TEXT NOT NULL,
      bot_access_json TEXT NOT NULL DEFAULT '{}'
    )
  `,
  `
    CREATE TABLE secrets (
        name TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
  `,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const statement of statements) yield* sql.unsafe(statement);
});
