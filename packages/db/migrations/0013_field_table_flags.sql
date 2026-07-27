-- Flag which domain fields earn a column on the Cases table (FieldDef.show_in_table).
-- The table's columns become configuration, closing the "Loan Type / Amount /
-- Entity hardcoded for every industry" leak. This backfills the flag onto field
-- configs that already exist; new provisioning carries it at insert time
-- (business-loan-config.ts, seed-demo.cjs).
--
-- jsonb_agg over jsonb_array_elements does not guarantee order, so elements are
-- re-aggregated WITH ORDINALITY. Idempotent: re-running sets the same values.
UPDATE field_configs fc
SET fields = (
  SELECT jsonb_agg(
    CASE elem->>'field_key'
      WHEN 'loan_type'   THEN elem || jsonb_build_object('show_in_table', true)
      WHEN 'entity_type' THEN elem || jsonb_build_object('show_in_table', true)
      WHEN 'loan_amount' THEN elem || jsonb_build_object('show_in_table', true, 'format', 'inr')
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(fc.fields) WITH ORDINALITY AS t(elem, ord)
)
FROM workflows w
WHERE fc.workflow_id = w.id
  AND w.slug = 'business-loan'
  AND jsonb_array_length(fc.fields) > 0;--> statement-breakpoint

UPDATE field_configs fc
SET fields = (
  SELECT jsonb_agg(
    CASE elem->>'field_key'
      WHEN 'course_applied' THEN elem || jsonb_build_object('show_in_table', true)
      WHEN 'entrance_exam'  THEN elem || jsonb_build_object('show_in_table', true)
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(fc.fields) WITH ORDINALITY AS t(elem, ord)
)
FROM workflows w
WHERE fc.workflow_id = w.id
  AND w.slug = 'college-admissions'
  AND jsonb_array_length(fc.fields) > 0;
