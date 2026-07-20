-- ---------------------------------------------------------------------------
-- Backfill the workflow vocabulary that migration 0005 never set.
--
-- 0005 added workflows.subject_label and workflows.case_label with the neutral
-- defaults 'Contact' and 'Case', which is right for a NEW workflow whose owner
-- has not chosen its words yet. It is wrong for the workflows that already
-- existed: those had a vocabulary declared in business-loan-config.ts
-- ('Borrower' / 'Application') and simply had nowhere to put it at the time.
-- Every such row silently kept the default, so a lender's dashboard has been
-- labelling its borrowers "Contact" — the API reads the column correctly, the
-- column just never received its value.
--
-- The guard on the current values matters twice over. It keeps this idempotent,
-- and it means the statement can only ever touch a row that is still holding
-- the untouched default — so a workspace that has deliberately chosen its own
-- words is left exactly as it is, now and on any future re-run.
--
-- Only the business-loan slug is named. Nothing else shipped before 0005, and
-- guessing a vocabulary for a workflow we did not create would be worse than
-- leaving the neutral default in place.
-- ---------------------------------------------------------------------------
UPDATE "workflows"
SET "subject_label" = 'Borrower',
    "case_label" = 'Application'
WHERE "slug" = 'business-loan'
  AND "subject_label" = 'Contact'
  AND "case_label" = 'Case';
