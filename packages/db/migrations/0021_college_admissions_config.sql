-- College Admissions: bring the workflow into the repository, and give it
-- the descriptions it never had.
--
-- This workflow has been live since before it was written down — workflow,
-- stages, 3 fields and 7 document requirements existed only as rows created ad
-- hoc. Nothing could recreate it, nobody could review it, and every one of its
-- seven descriptions was NULL, which is the worst possible input to the AI
-- classifier: it is the only guidance the model gets about what a document is.
--
-- SAFETY. Nothing is deleted. The seven existing items keep their keys, so any
-- document already filed against them stays exactly where it is; they gain the
-- descriptions they lacked. Eighteen new items are inserted. Fields are
-- replaced wholesale because field_configs stores them as one JSON array — the
-- three existing fields are carried through unchanged in that array.
--
-- CONDITIONS AND EXISTING CASES. New conditional items read fields that older
-- cases have not answered yet (course_level, category, seat_type...). An
-- unanswered condition evaluates FALSE, so those items are simply not asked
-- for until someone fills the field. That is the safe direction: a UG
-- applicant is never asked for a degree certificate they cannot have. Existing
-- cases can be completed from the case Overview at any time.
--
-- Generated from college-admissions-config.ts so the SQL cannot drift from the
-- constant. Idempotent: re-running writes the same values.


-- Workflow vocabulary (unchanged, asserted so the file is self-contained).
UPDATE workflows SET name = 'College Admissions', subject_label = 'Student', case_label = 'Admission'
WHERE slug = 'college-admissions';


-- Fields: replace the array, carrying the three existing fields through.
UPDATE field_configs fc SET fields = '[{"field_key":"course_applied","label":"Course applied for","field_type":"string","input_type":"text","required":true,"placeholder":"e.g. B.Sc Computer Science","order":0,"show_in_table":true},{"field_key":"course_level","label":"Course level","field_type":"enum","input_type":"dropdown","required":true,"options":["Undergraduate","Postgraduate","Diploma"],"order":1,"show_in_table":true},{"field_key":"admission_route","label":"Admission route","field_type":"enum","input_type":"dropdown","required":false,"options":["Entrance exam","Merit based","Counselling allotment","Direct"],"order":2,"show_in_table":true},{"field_key":"entrance_exam","label":"Entrance exam","field_type":"string","input_type":"text","required":false,"placeholder":"e.g. CUET, NEET, JEE","order":3,"show_in_table":true},{"field_key":"category","label":"Category","field_type":"enum","input_type":"dropdown","required":false,"options":["General","OBC","SC","ST","EWS","PwD"],"order":4,"show_in_table":true},{"field_key":"seat_type","label":"Seat type","field_type":"enum","input_type":"dropdown","required":false,"options":["State quota","All India","Management","NRI"],"order":5},{"field_key":"previous_school","label":"Previous school / college","field_type":"string","input_type":"text","required":false,"order":6},{"field_key":"has_gap","label":"Gap after last qualification?","field_type":"enum","input_type":"dropdown","required":false,"options":["No","Yes"],"order":7},{"field_key":"scholarship","label":"Applying for a scholarship?","field_type":"enum","input_type":"dropdown","required":false,"options":["No","Yes"],"order":8}]'::jsonb
FROM workflows w
WHERE fc.workflow_id = w.id AND w.slug = 'college-admissions';


-- Document requirements: update the seven that exist, insert the eighteen that
-- do not. ON CONFLICT keys on the (workflow_id, key) unique index.
INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'id_proof', 'Identity proof (Aadhaar, passport or voter ID)', 'Any ONE government-issued photo identity document of the STUDENT: Aadhaar, passport, voter ID or driving licence. NOT a parent''s or guardian''s ID, and NOT a school-issued identity card.', true, 1, true, NULL, NULL, 0
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'passport_photo', 'Passport photograph', 'A standalone passport-size headshot of the student on a plain background. NOT a photograph cropped out of a certificate, marksheet or identity card.', true, 1, true, 1095, NULL, 1
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'birth_certificate', 'Birth certificate', 'The municipal birth certificate, as proof of date of birth. A marksheet or school record that merely prints a date of birth is NOT this document.', true, 1, true, NULL, NULL, 2
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'marksheet_10', 'Class 10 marksheet', 'The board''s statement of marks for Class 10 / SSC. NOT the passing certificate, which is a separate document, and NOT the school leaving certificate.', true, 1, true, NULL, NULL, 3
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'certificate_10', 'Class 10 passing certificate', 'The board-issued certificate confirming the Class 10 pass. NOT the marksheet — this one certifies the result rather than listing subject marks.', true, 1, true, NULL, NULL, 4
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'marksheet_12', 'Class 12 marksheet', 'The board''s statement of marks for Class 12 / HSC — the document admission ranks are usually computed from. NOT the passing certificate. Asked for at every course level, including postgraduate.', true, 1, true, NULL, NULL, 5
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'certificate_12', 'Class 12 passing certificate', 'The board-issued certificate confirming the Class 12 pass. NOT the marksheet.', true, 1, true, NULL, NULL, 6
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'degree_marksheets', 'Degree marksheets (all semesters)', 'Consolidated or semester-wise marksheets of the qualifying degree. ALL semesters or years, not only the final one. NOT the degree certificate.', true, 12, true, NULL, '{"field":"course_level","equals":"Postgraduate"}'::jsonb, 7
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'degree_certificate', 'Degree / provisional certificate', 'The degree certificate for the qualifying degree, or the provisional certificate where the degree has not yet been conferred. NOT a marksheet.', true, 1, true, NULL, '{"field":"course_level","equals":"Postgraduate"}'::jsonb, 8
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'entrance_score', 'Entrance exam score card', 'The rank or score card for the entrance the seat was allotted on — CUET, JEE, NEET, CAT or a state CET. NOT the admit card or hall ticket, which is issued before the exam and carries no result.', true, 1, false, 365, '{"field":"admission_route","equals":"Entrance exam"}'::jsonb, 9
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'seat_allotment', 'Seat allotment letter', 'The allotment letter issued by the counselling authority naming this institution and course. NOT the entrance score card.', true, 1, false, NULL, '{"field":"admission_route","equals":"Counselling allotment"}'::jsonb, 10
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'transfer_certificate', 'Transfer certificate', 'The transfer certificate or school leaving certificate from the last institution attended, proving the student has formally left it. NOT the migration certificate, which permits a change of board or university.', true, 1, false, NULL, NULL, 11
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'migration_certificate', 'Migration certificate', 'Issued by the previous board or university, permitting migration to another. NOT the transfer certificate. Needed only when the student is changing board or university.', false, 1, false, NULL, NULL, 12
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'character_certificate', 'Character certificate', 'The conduct or character certificate from the last institution attended.', true, 1, false, 365, NULL, 13
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'gap_affidavit', 'Gap year affidavit', 'A notarised affidavit accounting for the break in education, naming the years concerned. Required only where there is a gap after the last qualification.', true, 1, false, NULL, '{"field":"has_gap","equals":"Yes"}'::jsonb, 14
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'caste_certificate', 'Caste certificate', 'The SC, ST or OBC certificate in the exact central or state format this institution requires. A certificate in the wrong format is routinely rejected at verification.', true, 1, true, NULL, '{"field":"category","in":["OBC","SC","ST"]}'::jsonb, 15
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'ncl_certificate', 'Non-creamy-layer certificate', 'The current-year non-creamy-layer certificate for OBC candidates. This EXPIRES — a certificate from an earlier financial year is not accepted. NOT the caste certificate itself.', true, 1, false, 365, '{"field":"category","equals":"OBC"}'::jsonb, 16
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'ews_certificate', 'EWS certificate', 'The Economically Weaker Section certificate in the prescribed format. NOT an income certificate, though it is issued on the basis of one.', true, 1, false, 365, '{"field":"category","equals":"EWS"}'::jsonb, 17
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'disability_certificate', 'Disability certificate', 'A UDID card or competent medical board certificate stating the percentage of disability.', true, 1, true, NULL, '{"field":"category","equals":"PwD"}'::jsonb, 18
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'domicile_certificate', 'Domicile / residence certificate', 'The competent authority''s certificate establishing state candidature. NOT an address proof such as a utility bill or rent agreement.', true, 1, true, NULL, '{"field":"seat_type","equals":"State quota"}'::jsonb, 19
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'income_certificate', 'Income certificate', 'The competent authority''s income certificate. NOT a salary slip, NOT an income tax return and NOT a bank statement — those evidence income but are not this certificate.', true, 1, false, 365, '{"field":"scholarship","equals":"Yes"}'::jsonb, 20
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'bank_proof', 'Bank account proof', 'Passbook first page or a cancelled cheque in the STUDENT''s name, for scholarship disbursement. A parent''s account is not accepted.', true, 1, true, NULL, '{"field":"scholarship","equals":"Yes"}'::jsonb, 21
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'medical_fitness', 'Medical fitness certificate', 'A registered medical practitioner''s fitness certificate, often on the institution''s own proforma. NOT a blood group report or a vaccination record.', false, 1, false, 180, NULL, 22
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'antiragging_undertaking', 'Anti-ragging undertaking', 'The UGC anti-ragging affidavit signed by student and parent, filed on the UGC portal and printed with its reference number.', true, 1, false, 365, NULL, 23
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'fee_receipt', 'Fee payment receipt', 'Proof of admission fee payment for this admission cycle. NOT a fee structure or demand note, which state what is owed rather than what was paid.', true, 1, false, NULL, NULL, 24
FROM workflows w WHERE w.slug = 'college-admissions'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;
