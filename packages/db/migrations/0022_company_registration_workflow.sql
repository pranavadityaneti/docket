-- Company Registration: ONE workflow serving nine entity types.
--
-- The shared core (promoter KYC, registered office, photographs) is about half
-- the checklist and identical whichever structure is being formed. Split into
-- nine workflows that core would be written nine times and would drift the
-- first time anyone corrected a description in one of them. Kept as one, the
-- differences are conditions on entity_type — the same mechanism the lending
-- workflow already uses to ask a Partnership for its deed and a Private
-- Limited for its incorporation certificate.
--
-- Conditions COMBINE rather than compete: foreign_promoter = Yes stacks the
-- apostilled documents on top of whichever entity type was chosen.
--
-- IDEMPOTENCY. Only `workflows` has a unique key (tenant_id, slug); stages and
-- field_configs have none, so those are guarded with NOT EXISTS rather than
-- ON CONFLICT — without that, re-running would silently duplicate all six
-- stages and give the workflow two field configs.
--
-- Created for every tenant that already runs Business Loan, which is how a
-- tenant is identified as live rather than a fixture.
--
-- Generated from company-registration-config.ts so the SQL cannot drift from
-- the constant.


-- 1. The workflow itself.
INSERT INTO workflows (tenant_id, name, slug, subject_label, case_label)
SELECT w.tenant_id, 'Company Registration', 'company-registration', 'Promoter', 'Registration'
FROM workflows w WHERE w.slug = 'business-loan'
ON CONFLICT (tenant_id, slug) DO UPDATE SET
  name = EXCLUDED.name, subject_label = EXCLUDED.subject_label, case_label = EXCLUDED.case_label;


-- 2. Stages. NOT EXISTS on (workflow_id, name) — no unique index to rely on.
INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'New request', 0, 'muted'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'New request');

INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'Name approval', 1, 'teal'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'Name approval');

INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'Documents pending', 2, 'teal'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'Documents pending');

INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'Filed', 3, 'amber'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'Filed');

INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'Query raised', 4, 'red'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'Query raised');

INSERT INTO workflow_stages (tenant_id, workflow_id, name, position, tone)
SELECT w.tenant_id, w.id, 'Incorporated', 5, 'green'
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM workflow_stages st WHERE st.workflow_id = w.id AND st.name = 'Incorporated');

-- Positions and tones re-asserted so a re-run corrects a hand edit.
UPDATE workflow_stages st SET position = 0, tone = 'muted'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'New request';
UPDATE workflow_stages st SET position = 1, tone = 'teal'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'Name approval';
UPDATE workflow_stages st SET position = 2, tone = 'teal'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'Documents pending';
UPDATE workflow_stages st SET position = 3, tone = 'amber'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'Filed';
UPDATE workflow_stages st SET position = 4, tone = 'red'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'Query raised';
UPDATE workflow_stages st SET position = 5, tone = 'green'
FROM workflows w WHERE st.workflow_id = w.id AND w.slug = 'company-registration' AND st.name = 'Incorporated';

-- 3. Field config. Inserted once, then always overwritten with the constant.
INSERT INTO field_configs (tenant_id, workflow_id, name, fields)
SELECT w.tenant_id, w.id, 'Registration', '[]'::jsonb
FROM workflows w
WHERE w.slug = 'company-registration'
  AND NOT EXISTS (SELECT 1 FROM field_configs fc WHERE fc.workflow_id = w.id);

UPDATE field_configs fc SET fields = '[{"field_key":"entity_type","label":"Entity type","field_type":"enum","input_type":"dropdown","required":true,"options":["Private Limited","Public Limited","One Person Company","LLP","Partnership Firm","Sole Proprietorship","Section 8 (NGO)","Nidhi","Producer Company"],"order":0,"show_in_table":true},{"field_key":"proposed_name_1","label":"Proposed name (first choice)","field_type":"string","input_type":"text","required":true,"placeholder":"e.g. Acme Technologies","order":1,"show_in_table":true},{"field_key":"proposed_name_2","label":"Proposed name (second choice)","field_type":"string","input_type":"text","required":false,"order":2},{"field_key":"office_state","label":"Registered office state","field_type":"string","input_type":"text","required":false,"placeholder":"e.g. Telangana","order":3,"show_in_table":true},{"field_key":"office_premises","label":"Registered office premises","field_type":"enum","input_type":"dropdown","required":false,"options":["Rented","Owned"],"order":4},{"field_key":"foreign_promoter","label":"Any foreign promoter or subscriber?","field_type":"enum","input_type":"dropdown","required":false,"options":["No","Yes"],"order":5},{"field_key":"number_of_promoters","label":"Number of promoters / directors","field_type":"integer","input_type":"number","required":false,"validation":{"minimum":"1","maximum":"50"},"order":6},{"field_key":"authorised_capital","label":"Authorised capital (₹)","field_type":"integer","input_type":"number","required":false,"order":7,"format":"inr"}]'::jsonb
FROM workflows w WHERE fc.workflow_id = w.id AND w.slug = 'company-registration';


-- 4. Document requirements. ON CONFLICT keys on (workflow_id, key).
INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'promoter_pan', 'PAN card of each promoter', 'The PAN card of every subscriber, director or partner. NOT an income tax return, Form 26AS or any other document that merely quotes a PAN number.', true, 15, true, NULL, NULL, 0
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'promoter_identity', 'Identity proof of each promoter', 'Any ONE government-issued photo identity per promoter: Aadhaar, passport, voter ID or driving licence. NOT the PAN card, which is collected separately.', true, 15, true, NULL, NULL, 1
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'promoter_address_proof', 'Residential address proof of each promoter (under 2 months old)', 'A utility bill or bank statement per promoter, DATED WITHIN THE LAST 2 MONTHS. An older bill is rejected at filing. NOT Aadhaar or a passport — those are identity proof, even though they print an address.', true, 15, false, 60, NULL, 2
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'promoter_photo', 'Passport photograph of each promoter', 'A standalone passport-size headshot per promoter, plain background. NOT a photo cropped from an identity document.', true, 15, true, 1095, NULL, 3
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'office_utility_bill', 'Utility bill for the registered office (under 2 months old)', 'Electricity, telephone, gas or water bill for the proposed registered office, DATED WITHIN THE LAST 2 MONTHS. It must show the office address, not a promoter''s home address.', true, 1, false, 60, NULL, 4
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'office_noc', 'NOC from the premises owner', 'A no-objection certificate signed by the owner permitting the address to be used as the registered office. NOT the rent agreement — this is the owner''s separate consent.', true, 1, false, NULL, '{"field":"office_premises","equals":"Rented"}'::jsonb, 5
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'office_rent_agreement', 'Rent / lease agreement for the office', 'The registered rent or lease agreement for the premises. NOT the owner''s NOC.', true, 1, false, NULL, '{"field":"office_premises","equals":"Rented"}'::jsonb, 6
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'office_ownership_proof', 'Ownership proof for the office', 'The sale deed or latest property tax receipt where the premises are owned by a promoter or the entity. NOT a rent agreement.', true, 1, false, NULL, '{"field":"office_premises","equals":"Owned"}'::jsonb, 7
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'dsc', 'Class 3 Digital Signature Certificate', 'A Class 3 DSC for every signing director or partner, from an MCA-authorised certifying authority. The filing cannot be submitted without it. NOT a DIN — a DSC is the signing token, a DIN is an identification number.', true, 15, false, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","LLP","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 8
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'din', 'DIN of existing directors', 'The Director Identification Number where a director already holds one. Where none exists it is applied for inside the incorporation form, so this is only for directors who already have one.', false, 15, true, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","LLP","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 9
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'moa', 'Memorandum of Association (MOA)', 'The MOA stating the objects and the subscribers to the memorandum. NOT the Articles of Association, though the two are usually issued together — the MOA defines what the company may do.', true, 1, false, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 10
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'aoa', 'Articles of Association (AOA)', 'The AOA setting out the company''s internal rules and governance. NOT the Memorandum — the AOA governs how the company runs, not what it may do.', true, 1, false, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 11
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'inc9', 'INC-9 declaration', 'The statutory declaration under section 7(1)(b) of the Companies Act by every subscriber and first director, confirming they are not disqualified. NOT the MOA or AOA.', true, 1, false, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 12
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'llp_agreement', 'LLP agreement', 'The agreement between designated partners governing the LLP, filed within 30 days of incorporation. An LLP has NO memorandum or articles — this document takes their place.', true, 1, false, NULL, '{"field":"entity_type","equals":"LLP"}'::jsonb, 13
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'partnership_deed', 'Partnership deed', 'The executed partnership deed on stamp paper, naming partners and profit-sharing ratios. NOT an LLP agreement, which is a different instrument under a different Act.', true, 1, false, NULL, '{"field":"entity_type","equals":"Partnership Firm"}'::jsonb, 14
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'inc3_nominee', 'Nominee consent (INC-3)', 'The written consent of the nominee who takes over the company on the sole member''s death or incapacity. Unique to a One Person Company — no other structure needs a nominee.', true, 1, false, NULL, '{"field":"entity_type","equals":"One Person Company"}'::jsonb, 15
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'section8_licence', 'Section 8 licence application', 'The application for a licence under section 8 to operate as a not-for-profit. It must be obtained BEFORE incorporation, unlike every other document here.', true, 1, false, NULL, '{"field":"entity_type","equals":"Section 8 (NGO)"}'::jsonb, 16
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'section8_projections', 'Three-year income & expenditure projection', 'The projected income and expenditure statement for three years, supporting the section 8 licence application. NOT audited financials — this is a forward projection.', true, 1, false, NULL, '{"field":"entity_type","equals":"Section 8 (NGO)"}'::jsonb, 17
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'nidhi_member_declarations', 'Declarations from the seven members', 'Signed declarations from the minimum seven members required to form a Nidhi. NOT the subscriber sheet of the MOA.', true, 10, false, NULL, '{"field":"entity_type","equals":"Nidhi"}'::jsonb, 18
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'producer_member_proof', 'Proof that members are primary producers', 'Evidence that each of the ten or more members is a primary producer — land records, farmer ID or a producer-organisation certificate. Unique to a Producer Company.', true, 15, false, NULL, '{"field":"entity_type","equals":"Producer Company"}'::jsonb, 19
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'proprietor_business_proof', 'Business registration proof', 'For a sole proprietorship there is no incorporation: the business is evidenced by a GST certificate, Udyam registration or Shop & Establishment licence. Any ONE of these.', true, 1, true, NULL, '{"field":"entity_type","equals":"Sole Proprietorship"}'::jsonb, 20
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'foreign_passport', 'Apostilled passport of foreign promoter', 'The passport of each foreign national promoter, notarised and apostilled (or consularised) in the country of origin. A plain photocopy is not accepted.', true, 10, true, NULL, '{"field":"foreign_promoter","equals":"Yes"}'::jsonb, 21
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'foreign_address_proof', 'Apostilled address proof of foreign promoter', 'Address proof for each foreign promoter, apostilled, and dated within the last 2 months. NOT the passport, which is identity.', true, 10, false, 60, '{"field":"foreign_promoter","equals":"Yes"}'::jsonb, 22
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'name_approval_letter', 'Name approval letter (RUN / SPICe+ Part A)', 'The approval letter reserving the proposed company name. NOT a trademark certificate.', false, 1, false, 20, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","LLP","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 23
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'trademark_noc', 'Trademark owner''s NOC', 'Where the proposed name matches a registered trademark, the trademark owner''s no-objection certificate authorising its use.', false, 1, false, NULL, NULL, 24
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'bank_account_form', 'Bank account opening form', 'The bank account opening application bundled with incorporation. NOT a cancelled cheque — the account does not exist yet.', false, 1, false, NULL, '{"field":"entity_type","in":["Private Limited","Public Limited","One Person Company","LLP","Section 8 (NGO)","Nidhi","Producer Company"]}'::jsonb, 25
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;

INSERT INTO document_requirements (tenant_id, workflow_id, key, label, description, required, max_files, reusable, validity_days, condition, position)
SELECT w.tenant_id, w.id, 'gst_application', 'GST registration application', 'The GST registration application submitted alongside incorporation. NOT a GST certificate, which is issued afterwards.', false, 1, false, NULL, NULL, 26
FROM workflows w WHERE w.slug = 'company-registration'
ON CONFLICT (workflow_id, key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, required = EXCLUDED.required,
  max_files = EXCLUDED.max_files, reusable = EXCLUDED.reusable, validity_days = EXCLUDED.validity_days,
  condition = EXCLUDED.condition, position = EXCLUDED.position;
