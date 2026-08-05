-- Disambiguate the Business Loan checklist descriptions.
--
-- These descriptions are the ONLY guidance the AI classifier gets about what
-- each item means (see apps/api/src/classify/classify.ts). Testing on 9 real
-- borrower documents on 31 Jul 2026 showed the cost of leaving them vague:
-- a PPF account record was read as "Passport photograph" with HIGH confidence
-- (it contains a photo), a Form 26AS was proposed as a PAN Card (it quotes a
-- PAN), and Office address proof had no description at all, leaving a utility
-- bill an unguided coin-flip between home and business premises.
--
-- Each description now states what the document IS and, where a real confusion
-- was observed, what it is NOT. Idempotent: re-running sets the same text.
UPDATE document_requirements dr SET description = 'The PAN card itself, for the proprietor, partners or directors. NOT a tax return, Form 26AS, annual tax statement or any other document that merely quotes a PAN number.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'applicant_pan';

UPDATE document_requirements dr SET description = 'The Aadhaar card issued by UIDAI, both sides, clearly legible. File an Aadhaar here even though it also shows an address - it is not the residence address proof.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'applicant_aadhaar';

UPDATE document_requirements dr SET description = 'A standalone passport-size headshot of the applicant, on a plain background. NOT a passport, and NOT a form, bank record or other document that happens to contain a photograph.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'photograph';

UPDATE document_requirements dr SET description = 'Proof of where the applicant LIVES: a utility bill, rent or lease agreement, or passport in their name for their home address. If the document is for business or commercial premises, it belongs to Office address proof instead. Do not file Aadhaar here.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'residence_address_proof';

UPDATE document_requirements dr SET description = 'Proof of where the BUSINESS operates: a utility bill, rent or lease agreement, or ownership document for the shop, office or commercial premises. If the document is for the applicant''s home, it belongs to Residence address proof instead. When a bill or agreement gives no indication whether the address is a home or a business, do not choose between these two with high confidence.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'office_address_proof';

UPDATE document_requirements dr SET description = 'Registration proving the business exists: Shop Act licence, Udyam/MSME registration, or trade licence. A GST certificate has its own item - do not file one here.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'business_proof';

UPDATE document_requirements dr SET description = 'The GST registration certificate (Form GST REG-06) showing the GSTIN. NOT a GST return such as GSTR-3B, which has its own item.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'gst_certificate';

UPDATE document_requirements dr SET description = 'The filed income tax return (ITR-V / acknowledgement) with its computation of income, last 2 assessment years. A Form 26AS or annual tax statement is NOT an ITR.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'itr_computation';

UPDATE document_requirements dr SET description = 'The auditor''s report and audited statements - Form 3CB/3CD with balance sheet and profit-and-loss, last 2 years. Not the income tax return itself, which has its own item.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'audited_financials';

UPDATE document_requirements dr SET description = 'Bank statements for the business current account(s), showing transactions, last 12 months. NOT a passbook photo, cheque, or a savings-scheme record such as PPF.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'bank_statements';

UPDATE document_requirements dr SET description = 'Filed GSTR-3B monthly return forms, last 12 months. NOT the GST registration certificate, which has its own item.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'gstr_3b';

UPDATE document_requirements dr SET description = 'Registered deed with the current partner list'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'partnership_deed';

UPDATE document_requirements dr SET description = 'With MOA and AOA'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'incorporation_certificate';
