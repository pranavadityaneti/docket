-- Identity proof, not "Aadhaar" — a compliance fix.
--
-- RBI KYC Master Direction accepts any ONE of six Officially Valid Documents
-- (passport, driving licence, proof of possession of Aadhaar, voter ID, NREGA
-- job card, NPR letter), and the Supreme Court struck down s.57 of the Aadhaar
-- Act — the provision that had let private entities compel Aadhaar. Naming
-- Aadhaar specifically and marking it REQUIRED asked borrowers for something a
-- private lender may not insist on.
--
-- It was costing classifications too: a borrower who sent a passport had no
-- slot that claimed it, so it was mis-filed as address proof or left unmatched.
--
-- Renaming the key is safe: nothing in the codebase hardcodes it (documents
-- reference requirement_id, a UUID), and the classifier builds its closed list
-- of answers from these rows at request time.
--
-- Residence address proof changes with it: it previously listed "passport" as
-- an accepted address proof, which after this change would let one document
-- satisfy two items. Identity documents now have exactly one home.
--
-- Generated from DOCUMENT_REQUIREMENTS in business-loan-config.ts so the SQL
-- cannot drift from the constant. Idempotent: matches the old key or the new.

UPDATE document_requirements dr SET key = 'applicant_identity', label = 'Identity proof (Aadhaar, passport or voter ID)', description = 'Any ONE government-issued identity document for the proprietor, partners or directors: Aadhaar (both sides), passport, driving licence, voter ID card, or NREGA job card. Aadhaar is accepted but is not required — any one of these is enough. File the identity document here even though it also shows an address; it is not the residence address proof.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key IN ('applicant_aadhaar', 'applicant_identity');

UPDATE document_requirements dr SET description = 'Proof of where the applicant LIVES: a utility bill, rent or lease agreement, or property tax receipt in their name for their home address. If the document is for business or commercial premises, it belongs to Office address proof instead. An identity document — Aadhaar, passport, driving licence or voter ID — belongs to Identity proof, not here, even though it shows an address.'
FROM workflows w
WHERE dr.workflow_id = w.id AND w.slug = 'business-loan' AND dr.key = 'residence_address_proof';
