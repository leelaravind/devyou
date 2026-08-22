-- Invariant enforcement at the database.
--
-- Everything in this file exists because the domain layer alone is not enough.
-- A helpful refactor, a one-off admin fix, a migration script run in a hurry — all
-- of those bypass application code, and each is exactly the situation where somebody
-- "just needs to correct one word" in a published revision.
--
-- These triggers make that impossible rather than discouraged. They are the belt;
-- the domain layer in @devyou/domain is the braces; the tests in this package prove
-- both hold.
--
-- SQLite trigger notes that matter here:
--   * RAISE(ABORT, ...) rolls the statement back and surfaces the message.
--   * `UPDATE OF col` fires only for statements naming those columns, so lifecycle
--     columns can move freely while content columns cannot.
--   * Triggers run inside the statement's transaction, so a batch that violates one
--     fails whole.

-- ---------------------------------------------------------------------------
-- 1. A published revision's content is frozen.
-- ---------------------------------------------------------------------------
--
-- Lifecycle columns are deliberately absent from the `UPDATE OF` list: status,
-- superseded_at, deprecated_at, deprecation_reason, needs_reverification_at and
-- needs_reverification_reason must keep moving after publication. A revision that
-- could never be marked deprecated would be worse than a mutable one.

CREATE TRIGGER trg_revision_content_immutable
BEFORE UPDATE OF title, summary, change_summary, playbook_id, revision_number,
                 created_by, created_at, published_at, supersedes_revision_id
ON playbook_revisions
FOR EACH ROW
WHEN OLD.published_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'playbook_revisions: published revisions are immutable — create a new revision (ADR-0005)');
END;

-- Unpublishing is not a correction, it is a way to make evidence describe text that
-- is no longer visible. Withdrawal is `status = quarantined`, which keeps the URL
-- and the evidence trail intact.
CREATE TRIGGER trg_revision_no_unpublish
BEFORE UPDATE OF published_at ON playbook_revisions
FOR EACH ROW
WHEN OLD.published_at IS NOT NULL AND NEW.published_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'playbook_revisions: a published revision cannot be unpublished — quarantine it instead');
END;

CREATE TRIGGER trg_revision_no_delete_published
BEFORE DELETE ON playbook_revisions
FOR EACH ROW
WHEN OLD.published_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'playbook_revisions: published revisions are never deleted — evidence points at them');
END;

-- ---------------------------------------------------------------------------
-- 2. The graph of a published revision is frozen too.
-- ---------------------------------------------------------------------------
--
-- Freezing the revision row while leaving its nodes editable would be a fiction:
-- the readable content of a playbook is its nodes, and evidence attaches to them.

CREATE TRIGGER trg_nodes_immutable_after_publish
BEFORE UPDATE ON diagnostic_nodes
FOR EACH ROW
WHEN (SELECT published_at FROM playbook_revisions WHERE id = OLD.revision_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_nodes: belongs to a published revision — create a new revision');
END;

CREATE TRIGGER trg_nodes_no_insert_after_publish
BEFORE INSERT ON diagnostic_nodes
FOR EACH ROW
WHEN (SELECT published_at FROM playbook_revisions WHERE id = NEW.revision_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_nodes: cannot add a node to a published revision');
END;

CREATE TRIGGER trg_nodes_no_delete_after_publish
BEFORE DELETE ON diagnostic_nodes
FOR EACH ROW
WHEN (SELECT published_at FROM playbook_revisions WHERE id = OLD.revision_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_nodes: cannot remove a node from a published revision');
END;

CREATE TRIGGER trg_edges_immutable_after_publish
BEFORE UPDATE ON diagnostic_edges
FOR EACH ROW
WHEN (SELECT published_at FROM playbook_revisions WHERE id = OLD.revision_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_edges: belongs to a published revision — create a new revision');
END;

CREATE TRIGGER trg_edges_no_insert_after_publish
BEFORE INSERT ON diagnostic_edges
FOR EACH ROW
WHEN (SELECT published_at FROM playbook_revisions WHERE id = NEW.revision_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_edges: cannot add an edge to a published revision');
END;

-- ---------------------------------------------------------------------------
-- 3. No edge may cross a revision boundary.
-- ---------------------------------------------------------------------------
--
-- A cross-revision edge would let a diagnostic session walk out of the text that
-- was tested and into text that was not — the same defect as transferring evidence,
-- arriving by a different route. The engine checks it too; this makes the bad row
-- impossible to store in the first place.

CREATE TRIGGER trg_edges_same_revision
BEFORE INSERT ON diagnostic_edges
FOR EACH ROW
WHEN (SELECT revision_id FROM diagnostic_nodes WHERE id = NEW.from_node_id) IS NOT NEW.revision_id
  OR (SELECT revision_id FROM diagnostic_nodes WHERE id = NEW.to_node_id) IS NOT NEW.revision_id
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_edges: both endpoints must belong to this revision');
END;

-- A node carrying a command must say how dangerous it is. `informational` is a
-- legitimate answer; silence is not, because the reader is shown a copy button
-- either way and an unclassified command renders without a warning.
CREATE TRIGGER trg_nodes_command_needs_safety
BEFORE INSERT ON diagnostic_nodes
FOR EACH ROW
WHEN NEW.command_text IS NOT NULL
 AND NEW.safety_level NOT IN ('informational', 'state_changing', 'destructive', 'credential_sensitive')
BEGIN
  SELECT RAISE(ABORT, 'diagnostic_nodes: a node with a command requires a valid safety_level');
END;

-- ---------------------------------------------------------------------------
-- 4. Evidence is append-only.
-- ---------------------------------------------------------------------------
--
-- The only mutable columns are the suppression pair, and suppression does not
-- remove anything: the row stays readable in the admin inspector, because the proof
-- that justified suppressing it is the row.
--
-- Note there is no exception for an administrator. Plan §0.3 keeps failed
-- reproductions as evidence, and a system where an inconvenient result can be
-- deleted by anybody produces confidence figures that mean nothing.

CREATE TRIGGER trg_evidence_append_only_update
BEFORE UPDATE OF id, revision_id, node_id, evidence_type, result, actor_id,
                 environment_snapshot_id, source_reference_id, attachment_key,
                 metadata_json, created_at
ON evidence_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'evidence_records is append-only — suppress it, do not edit it (ADR-0005)');
END;

CREATE TRIGGER trg_evidence_append_only_delete
BEFORE DELETE ON evidence_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'evidence_records is append-only — evidence is never deleted, including failures');
END;

CREATE TRIGGER trg_reproduction_append_only_update
BEFORE UPDATE OF id, revision_id, actor_id, environment_snapshot_id, outcome,
                 reached_node_id, notes, evidence_record_id, created_at
ON reproduction_reports
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'reproduction_reports is append-only — a report cannot be rewritten');
END;

CREATE TRIGGER trg_reproduction_append_only_delete
BEFORE DELETE ON reproduction_reports
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'reproduction_reports is append-only — a failed reproduction is evidence');
END;

-- Evidence may only ever point at a revision that exists and has been published.
-- Evidence against a draft would be evidence about text nobody else can read.
CREATE TRIGGER trg_evidence_requires_published_revision
BEFORE INSERT ON evidence_records
FOR EACH ROW
WHEN NEW.evidence_type <> 'contributor_documentation'
 AND (SELECT published_at FROM playbook_revisions WHERE id = NEW.revision_id) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'evidence_records: evidence may only attach to a published revision');
END;

-- ---------------------------------------------------------------------------
-- 5. The audit log is append-only.
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_audit_append_only_update
BEFORE UPDATE ON admin_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_events is append-only');
END;

CREATE TRIGGER trg_audit_append_only_delete
BEFORE DELETE ON admin_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_events is append-only');
END;

-- ---------------------------------------------------------------------------
-- 6. Full-text search.
-- ---------------------------------------------------------------------------
--
-- FTS5 with its own content copy rather than an external-content table. External
-- content is more space-efficient and needs three synchronisation triggers per
-- source table across five source tables; the copy costs a few megabytes on a
-- corpus of tens of playbooks and removes fifteen triggers that could silently
-- drift.
--
-- The index is rebuilt for a revision on publish, by application code, which is
-- also where the searchable text is assembled — a document is a revision's title,
-- summary, its nodes' titles and bodies, its technologies and their aliases, and
-- the problem's error signatures. That assembly is a ranking decision, not a
-- schema one, so it belongs in @devyou/search rather than in a trigger.
--
-- `unicode61` with `remove_diacritics 2`, and a tokenchars list that keeps the
-- characters error messages are actually made of. Without it, `SQLITE_BUSY`
-- tokenises as `sqlite` + `busy`, `ECONNREFUSED` survives but `net::ERR_FAILED`
-- does not, and `pg_stat_activity` becomes three useless tokens. Getting this wrong
-- silently degrades exactly the queries the product exists to answer.

CREATE VIRTUAL TABLE playbook_fts USING fts5(
  revision_id UNINDEXED,
  playbook_id UNINDEXED,
  title,
  summary,
  error_text,
  node_text,
  technology_text,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_-.:/'"
);

-- Exact error signatures get their own index. R-18/R-19: an exact error code is a
-- much stronger signal than a full-text match on the same string, and it must be
-- searched *first* rather than blended into a relevance score where a long,
-- well-written summary can outrank it.
CREATE VIRTUAL TABLE signature_fts USING fts5(
  signature_id UNINDEXED,
  problem_id UNINDEXED,
  error_code,
  normalized_message,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_-.:/'"
);

-- ---------------------------------------------------------------------------
-- 7. Indexes the ORM does not generate
-- ---------------------------------------------------------------------------

-- The hot read path: a published playbook by slug, with its current revision.
CREATE INDEX idx_playbooks_published
  ON playbooks (slug, status)
  WHERE current_revision_id IS NOT NULL;

-- Staleness sweeps scan for published revisions with no recent successful
-- verification. Without this the job is a full table scan of every revision.
CREATE INDEX idx_revisions_staleness
  ON playbook_revisions (status, published_at)
  WHERE published_at IS NOT NULL;

-- Confidence derivation reads evidence by revision and type, excluding suppressed.
CREATE INDEX idx_evidence_active
  ON evidence_records (revision_id, evidence_type, result)
  WHERE suppressed_at IS NULL;
