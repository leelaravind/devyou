-- The reason an AI-inferred field is what it is.
--
-- `structureContributionTask` already makes the model state, in one sentence, why it
-- believes each field it emits — see `tracked()` in packages/ai/src/tasks.ts, whose
-- comment says that sentence is shown beside the field on the review screen. There
-- was nowhere to put it, so it was being discarded between the model and the author.
--
-- That gap is not cosmetic. Plan §10 step D requires the author to explicitly
-- confirm every inferred field, and a confirmation checkbox next to a value with no
-- stated reasoning is a checkbox people tick. The whole mechanism that keeps AI
-- advisory rests on the author being able to *evaluate* an inference, which they
-- cannot do without knowing what it was drawn from.
--
-- Nullable, because a field whose provenance is `user_supplied` has no model
-- reasoning to record and inventing one would be a lie in a column.

ALTER TABLE draft_field_provenance ADD COLUMN basis text;
