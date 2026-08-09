-- 002_backfill_null_branch_and_default.sql
--
-- Fixes a gap discovered 2026-08-09: production (main) is still running the pre-migration
-- Netlify functions, which never send branch_id. Every student/membership/payment created
-- since the 001 migration's one-time backfill (~Aug 5) has landed with branch_id = NULL
-- instead of Vigyan Nagar's id — 16 real students as of today. This will keep happening on
-- every new registration until multi-branch-feature is merged and deployed.
--
-- 1) One-time backfill of the 16 existing NULL rows to Vigyan Nagar (production has only
--    ever served Vigyan Nagar, so there's no ambiguity about which branch these belong to).
-- 2) DEFAULT on branch_id so any *future* insert from the still-live old production code
--    (until deploy) falls back to Vigyan Nagar instead of NULL. Harmless post-merge — the
--    new code always passes branch_id explicitly, which overrides any column default.
--
-- Vigyan Nagar's id, confirmed live: 5043c467-924a-4e03-9c1b-fae1b1633d1f

BEGIN;

UPDATE students
SET branch_id = '5043c467-924a-4e03-9c1b-fae1b1633d1f'
WHERE branch_id IS NULL;

UPDATE memberships
SET branch_id = '5043c467-924a-4e03-9c1b-fae1b1633d1f'
WHERE branch_id IS NULL;

UPDATE payments
SET branch_id = '5043c467-924a-4e03-9c1b-fae1b1633d1f'
WHERE branch_id IS NULL;

ALTER TABLE students    ALTER COLUMN branch_id SET DEFAULT '5043c467-924a-4e03-9c1b-fae1b1633d1f';
ALTER TABLE memberships ALTER COLUMN branch_id SET DEFAULT '5043c467-924a-4e03-9c1b-fae1b1633d1f';
ALTER TABLE payments    ALTER COLUMN branch_id SET DEFAULT '5043c467-924a-4e03-9c1b-fae1b1633d1f';

COMMIT;

-- Verification (run after commit — all three should return 0):
-- SELECT count(*) FROM students WHERE branch_id IS NULL;
-- SELECT count(*) FROM memberships WHERE branch_id IS NULL;
-- SELECT count(*) FROM payments WHERE branch_id IS NULL;
