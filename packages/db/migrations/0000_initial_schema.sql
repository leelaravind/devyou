CREATE TABLE `actor_trust` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_age_days` integer DEFAULT 0 NOT NULL,
	`distinct_environments` integer DEFAULT 0 NOT NULL,
	`reproduction_count` integer DEFAULT 0 NOT NULL,
	`suspected_cluster` text,
	`weight` integer DEFAULT 100 NOT NULL,
	`computed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actor_trust_cluster_idx` ON `actor_trust` (`suspected_cluster`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`handle` text NOT NULL,
	`avatar_url` text,
	`github_login` text,
	`bio` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);--> statement-breakpoint
CREATE INDEX `profiles_github_idx` ON `profiles` (`github_login`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent_family` text,
	`ip_hash` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email` text,
	`email_verified_at` integer,
	`network_actor_id` text,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);--> statement-breakpoint
CREATE TABLE `technologies` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`official_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technologies_slug_unique` ON `technologies` (`slug`);--> statement-breakpoint
CREATE INDEX `technologies_type_idx` ON `technologies` (`type`);--> statement-breakpoint
CREATE TABLE `technology_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`technology_id` text NOT NULL,
	`alias` text NOT NULL,
	`kind` text DEFAULT 'name' NOT NULL,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technology_aliases_unique` ON `technology_aliases` (`alias`,`technology_id`);--> statement-breakpoint
CREATE INDEX `technology_aliases_alias_idx` ON `technology_aliases` (`alias`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`technology_id` text NOT NULL,
	`version_label` text NOT NULL,
	`semver_normalized` text,
	`released_at` integer,
	`eol_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`is_minor_or_major` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_unique` ON `versions` (`technology_id`,`version_label`);--> statement-breakpoint
CREATE INDEX `versions_sort_idx` ON `versions` (`technology_id`,`semver_normalized`);--> statement-breakpoint
CREATE INDEX `versions_released_idx` ON `versions` (`released_at`);--> statement-breakpoint
CREATE TABLE `diagnostic_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`condition_type` text NOT NULL,
	`condition_label` text,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnostic_edges_revision_idx` ON `diagnostic_edges` (`revision_id`);--> statement-breakpoint
CREATE INDEX `diagnostic_edges_from_idx` ON `diagnostic_edges` (`from_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_edges_unique` ON `diagnostic_edges` (`from_node_id`,`condition_type`,`to_node_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`node_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`command_text` text,
	`command_language` text,
	`expected_output` text,
	`safety_level` text DEFAULT 'informational' NOT NULL,
	`safety_effect` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnostic_nodes_revision_idx` ON `diagnostic_nodes` (`revision_id`);--> statement-breakpoint
CREATE INDEX `diagnostic_nodes_type_idx` ON `diagnostic_nodes` (`revision_id`,`node_type`);--> statement-breakpoint
CREATE TABLE `playbook_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`from_playbook_id` text NOT NULL,
	`to_playbook_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`confirmation_state` text DEFAULT 'ai_suggested' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_relations_unique` ON `playbook_relations` (`from_playbook_id`,`to_playbook_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `playbook_relations_to_idx` ON `playbook_relations` (`to_playbook_id`);--> statement-breakpoint
CREATE TABLE `playbook_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`change_summary` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	`supersedes_revision_id` text,
	`superseded_at` integer,
	`deprecated_at` integer,
	`deprecation_reason` text,
	`needs_reverification_at` integer,
	`needs_reverification_reason` text,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_revisions_number_unique` ON `playbook_revisions` (`playbook_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `playbook_revisions_playbook_idx` ON `playbook_revisions` (`playbook_id`);--> statement-breakpoint
CREATE INDEX `playbook_revisions_status_idx` ON `playbook_revisions` (`status`);--> statement-breakpoint
CREATE INDEX `playbook_revisions_published_idx` ON `playbook_revisions` (`published_at`);--> statement-breakpoint
CREATE TABLE `playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`slug` text NOT NULL,
	`current_revision_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbooks_slug_unique` ON `playbooks` (`slug`);--> statement-breakpoint
CREATE INDEX `playbooks_problem_idx` ON `playbooks` (`problem_id`);--> statement-breakpoint
CREATE INDEX `playbooks_status_idx` ON `playbooks` (`status`);--> statement-breakpoint
CREATE TABLE `problem_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`error_code` text,
	`normalized_message` text NOT NULL,
	`signature_hash` text NOT NULL,
	`language_hint` text,
	`runtime_hint` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_signatures_hash_idx` ON `problem_signatures` (`signature_hash`);--> statement-breakpoint
CREATE INDEX `problem_signatures_code_idx` ON `problem_signatures` (`error_code`);--> statement-breakpoint
CREATE INDEX `problem_signatures_problem_idx` ON `problem_signatures` (`problem_id`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`canonical_title` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_slug_unique` ON `problems` (`slug`);--> statement-breakpoint
CREATE INDEX `problems_status_idx` ON `problems` (`status`);--> statement-breakpoint
CREATE TABLE `revision_environment_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`technology_id` text NOT NULL,
	`min_version_id` text,
	`max_version_id` text,
	`min_semver` text,
	`max_semver` text,
	`max_inclusive` integer DEFAULT false NOT NULL,
	`architecture` text,
	`constraint_kind` text DEFAULT 'required' NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`min_version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`max_version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `revision_env_constraints_revision_idx` ON `revision_environment_constraints` (`revision_id`);--> statement-breakpoint
CREATE INDEX `revision_env_constraints_tech_idx` ON `revision_environment_constraints` (`technology_id`);--> statement-breakpoint
CREATE TABLE `revision_source_references` (
	`revision_id` text NOT NULL,
	`source_reference_id` text NOT NULL,
	`node_id` text,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_reference_id`) REFERENCES `source_references`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_source_refs_unique` ON `revision_source_references` (`revision_id`,`source_reference_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `revision_technologies` (
	`revision_id` text NOT NULL,
	`technology_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_technologies_unique` ON `revision_technologies` (`revision_id`,`technology_id`);--> statement-breakpoint
CREATE INDEX `revision_technologies_tech_idx` ON `revision_technologies` (`technology_id`);--> statement-breakpoint
CREATE TABLE `source_references` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`publisher` text,
	`retrieved_at` integer NOT NULL,
	`safety_flag` text
);
--> statement-breakpoint
CREATE INDEX `source_references_url_idx` ON `source_references` (`url`);--> statement-breakpoint
CREATE INDEX `source_references_type_idx` ON `source_references` (`source_type`);--> statement-breakpoint
CREATE TABLE `symptoms` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`description` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `symptoms_problem_idx` ON `symptoms` (`problem_id`);--> statement-breakpoint
CREATE TABLE `environment_preset_components` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_id` text NOT NULL,
	`technology_id` text,
	`raw_label` text NOT NULL,
	`semver_normalized` text,
	FOREIGN KEY (`preset_id`) REFERENCES `environment_presets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `environment_preset_components_preset_idx` ON `environment_preset_components` (`preset_id`);--> statement-breakpoint
CREATE TABLE `environment_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`os_family` text,
	`os_version` text,
	`architecture` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `environment_presets_user_idx` ON `environment_presets` (`user_id`);--> statement-breakpoint
CREATE TABLE `environment_snapshot_components` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`technology_id` text,
	`version_id` text,
	`raw_label` text NOT NULL,
	`semver_normalized` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `environment_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `env_snapshot_components_snapshot_idx` ON `environment_snapshot_components` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `env_snapshot_components_tech_idx` ON `environment_snapshot_components` (`technology_id`);--> statement-breakpoint
CREATE TABLE `environment_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`label` text NOT NULL,
	`os_family` text,
	`os_version` text,
	`architecture` text,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `environment_snapshots_fingerprint_idx` ON `environment_snapshots` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `evidence_records` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`node_id` text,
	`evidence_type` text NOT NULL,
	`result` text NOT NULL,
	`actor_id` text,
	`environment_snapshot_id` text,
	`source_reference_id` text,
	`attachment_key` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`suppressed_at` integer,
	`suppression_reason` text,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_snapshot_id`) REFERENCES `environment_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_reference_id`) REFERENCES `source_references`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `evidence_records_revision_idx` ON `evidence_records` (`revision_id`);--> statement-breakpoint
CREATE INDEX `evidence_records_node_idx` ON `evidence_records` (`node_id`);--> statement-breakpoint
CREATE INDEX `evidence_records_type_idx` ON `evidence_records` (`revision_id`,`evidence_type`);--> statement-breakpoint
CREATE INDEX `evidence_records_actor_idx` ON `evidence_records` (`actor_id`);--> statement-breakpoint
CREATE INDEX `evidence_records_created_idx` ON `evidence_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `reproduction_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text,
	`environment_snapshot_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reached_node_id` text,
	`notes` text,
	`evidence_record_id` text,
	`created_at` integer NOT NULL,
	`ip_hash` text,
	`turnstile_verified` integer DEFAULT false NOT NULL,
	`review_state` text DEFAULT 'accepted' NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_snapshot_id`) REFERENCES `environment_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reached_node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evidence_record_id`) REFERENCES `evidence_records`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reproduction_reports_actor_revision_unique` ON `reproduction_reports` (`revision_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `reproduction_reports_revision_idx` ON `reproduction_reports` (`revision_id`);--> statement-breakpoint
CREATE INDEX `reproduction_reports_outcome_idx` ON `reproduction_reports` (`revision_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `reproduction_reports_created_idx` ON `reproduction_reports` (`created_at`);--> statement-breakpoint
CREATE TABLE `revision_confidence` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`band` text NOT NULL,
	`reproduced_passed` integer DEFAULT 0 NOT NULL,
	`reproduced_partial` integer DEFAULT 0 NOT NULL,
	`reproduced_failed` integer DEFAULT 0 NOT NULL,
	`independent_confirmations` integer DEFAULT 0 NOT NULL,
	`unique_environments` integer DEFAULT 0 NOT NULL,
	`ci_executions` integer DEFAULT 0 NOT NULL,
	`maintainer_attestations` integer DEFAULT 0 NOT NULL,
	`official_references` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revision_confidence_band_idx` ON `revision_confidence` (`band`);--> statement-breakpoint
CREATE TABLE `revision_confidence_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`technology_id` text,
	`version_bucket` text,
	`os_family` text,
	`passed` integer DEFAULT 0 NOT NULL,
	`partial` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`last_report_at` integer,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_confidence_segments_unique` ON `revision_confidence_segments` (`revision_id`,`technology_id`,`version_bucket`,`os_family`);--> statement-breakpoint
CREATE INDEX `revision_confidence_segments_revision_idx` ON `revision_confidence_segments` (`revision_id`);--> statement-breakpoint
CREATE TABLE `change_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`node_id` text,
	`author_id` text,
	`proposal_type` text NOT NULL,
	`body` text NOT NULL,
	`payload_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_reason` text,
	`resolved_by` text,
	`resolved_at` integer,
	`resulting_revision_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resulting_revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `change_proposals_revision_idx` ON `change_proposals` (`revision_id`);--> statement-breakpoint
CREATE INDEX `change_proposals_status_idx` ON `change_proposals` (`status`);--> statement-breakpoint
CREATE INDEX `change_proposals_author_idx` ON `change_proposals` (`author_id`);--> statement-breakpoint
CREATE TABLE `contribution_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`playbook_id` text,
	`based_on_revision_id` text,
	`raw_text` text DEFAULT '' NOT NULL,
	`structured_json` text,
	`status` text DEFAULT 'capturing' NOT NULL,
	`ai_task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_revision_id` text,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`based_on_revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`published_revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contribution_drafts_author_idx` ON `contribution_drafts` (`author_id`);--> statement-breakpoint
CREATE INDEX `contribution_drafts_status_idx` ON `contribution_drafts` (`status`);--> statement-breakpoint
CREATE TABLE `diagnostic_session_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`node_id` text NOT NULL,
	`observed_condition` text,
	`step_index` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`invalidated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `diagnostic_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnostic_session_steps_session_idx` ON `diagnostic_session_steps` (`session_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `diagnostic_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text,
	`environment_snapshot_id` text,
	`active_node_id` text,
	`outcome_node_id` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`outcome_node_id`) REFERENCES `diagnostic_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diagnostic_sessions_actor_idx` ON `diagnostic_sessions` (`actor_id`);--> statement-breakpoint
CREATE INDEX `diagnostic_sessions_revision_idx` ON `diagnostic_sessions` (`revision_id`);--> statement-breakpoint
CREATE INDEX `diagnostic_sessions_expiry_idx` ON `diagnostic_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `draft_field_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`field_path` text NOT NULL,
	`provenance` text NOT NULL,
	`confirmed_at` integer,
	`confirmed_by` text,
	`original_value` text,
	FOREIGN KEY (`draft_id`) REFERENCES `contribution_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_field_provenance_unique` ON `draft_field_provenance` (`draft_id`,`field_path`);--> statement-breakpoint
CREATE INDEX `draft_field_provenance_draft_idx` ON `draft_field_provenance` (`draft_id`);--> statement-breakpoint
CREATE TABLE `admin_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`capability` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`reason_detail` text,
	`change_json` text,
	`step_up_verified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_actor_idx` ON `admin_audit_events` (`actor_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_events_subject_idx` ON `admin_audit_events` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_events_created_idx` ON `admin_audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `ai_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_type` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_micro_usd` integer,
	`latency_ms` integer,
	`repair_attempted` integer DEFAULT false NOT NULL,
	`error_detail` text,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_tasks_type_idx` ON `ai_tasks` (`task_type`,`status`);--> statement-breakpoint
CREATE INDEX `ai_tasks_cache_idx` ON `ai_tasks` (`task_type`,`input_hash`);--> statement-breakpoint
CREATE INDEX `ai_tasks_created_idx` ON `ai_tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_tasks_requester_idx` ON `ai_tasks` (`requested_by`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`description` text NOT NULL,
	`value_json` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `moderation_case_evidence` (
	`case_id` text NOT NULL,
	`evidence_record_id` text,
	`reproduction_report_id` text,
	`playbook_id` text,
	`revision_id` text,
	FOREIGN KEY (`case_id`) REFERENCES `moderation_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_record_id`) REFERENCES `evidence_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reproduction_report_id`) REFERENCES `reproduction_reports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`playbook_id`) REFERENCES `playbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `playbook_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moderation_case_evidence_case_idx` ON `moderation_case_evidence` (`case_id`);--> statement-breakpoint
CREATE TABLE `moderation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`origin` text NOT NULL,
	`reporter_id` text,
	`detail` text,
	`severity` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_reason` text,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_cases_status_idx` ON `moderation_cases` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `moderation_cases_subject_idx` ON `moderation_cases` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `official_identity_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`technology_id` text NOT NULL,
	`claim_type` text NOT NULL,
	`evidence_url` text,
	`evidence_detail` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `official_identity_claims_unique` ON `official_identity_claims` (`user_id`,`technology_id`,`claim_type`);--> statement-breakpoint
CREATE INDEX `official_identity_claims_status_idx` ON `official_identity_claims` (`status`);--> statement-breakpoint
CREATE TABLE `rate_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`action` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_counters_unique` ON `rate_counters` (`subject`,`action`,`window_start`);--> statement-breakpoint
CREATE INDEX `rate_counters_window_idx` ON `rate_counters` (`window_start`);--> statement-breakpoint
CREATE TABLE `search_events` (
	`id` text PRIMARY KEY NOT NULL,
	`signature_hash` text,
	`query_shape` text NOT NULL,
	`query_token_count` integer DEFAULT 0 NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`clicked_rank` integer,
	`had_environment_filter` integer DEFAULT false NOT NULL,
	`session_bucket` text,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `search_events_created_idx` ON `search_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `search_events_zero_idx` ON `search_events` (`result_count`);--> statement-breakpoint
CREATE INDEX `search_events_signature_idx` ON `search_events` (`signature_hash`);