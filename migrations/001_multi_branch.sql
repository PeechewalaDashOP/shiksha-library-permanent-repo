-- ============================================================
-- Multi-branch support
-- ============================================================
-- Adds branches, admin->branch mapping, nullable branch_id columns on
-- students/memberships/payments/plans, and rewrites the RLS policies that
-- gate admin access to be branch-aware.
--
-- Prerequisite (already shipped separately on 2026-08-04, live-verified):
-- the "Allow public update on plans" policy (USING true / WITH CHECK true,
-- no auth check at all) was replaced with an is_admin()-gated policy. That
-- fix is NOT part of this file since it already ran standalone.
--
-- This is a one-time migration (not idempotent / not safe to re-run) —
-- a full data + schema backup was taken immediately before running this,
-- see Documents/shiksha-library/db-backups/.
--
-- Run as a single transaction.

BEGIN;

-- ============================================================
-- 1. branches
-- ============================================================
CREATE TABLE public.branches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.branches (name) VALUES
  ('Vigyan Nagar'),
  ('Mahaveer Nagar'),
  ('Kunhadi');

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Branches are viewable by everyone" ON public.branches
  FOR SELECT USING (true);

CREATE POLICY "Service role full access branches" ON public.branches
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 2. admins (email -> branch mapping; branch_id NULL = sees all branches)
-- Deliberately minimal — a later, separate Employee RBAC feature will
-- extend this. No admin-facing UI to manage this table yet; rows are
-- inserted directly via SQL.
-- ============================================================
CREATE TABLE public.admins (
  email TEXT PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.admins (email, branch_id) VALUES
  ('namangalav230@gmail.com', NULL),
  ('mahaveerrathore112@gmail.com', NULL);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access admins" ON public.admins
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 3. branch_id columns — nullable, additive, ON DELETE SET NULL
-- ============================================================
ALTER TABLE public.students    ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.memberships ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.payments    ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.plans       ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Backfill all existing rows to Vigyan Nagar (the only branch live today)
-- ============================================================
DO $$
DECLARE vn_id UUID;
BEGIN
  SELECT id INTO vn_id FROM public.branches WHERE name = 'Vigyan Nagar';

  UPDATE public.students    SET branch_id = vn_id WHERE branch_id IS NULL;
  UPDATE public.memberships SET branch_id = vn_id WHERE branch_id IS NULL;
  UPDATE public.payments    SET branch_id = vn_id WHERE branch_id IS NULL;
  UPDATE public.plans       SET branch_id = vn_id WHERE branch_id IS NULL;
END $$;

-- ============================================================
-- 5. is_admin() rewrite (was a hardcoded 2-email array in the function
-- body) to read from the admins table instead, + new admin_branch_id()
-- companion that RLS policies (and the admin.html/admin-register.html
-- frontends, via sb.rpc('admin_branch_id')) use to determine scope.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.admins a ON a.email = u.email
    WHERE u.id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_branch_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT a.branch_id FROM auth.users u
  JOIN public.admins a ON a.email = u.email
  WHERE u.id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_branch_id() TO authenticated;

-- ============================================================
-- 6. Replace loose/broken admin RLS policies with is_admin() +
-- branch-aware versions. These previously used
-- `auth.role() = 'authenticated'` (i.e. ANY logged-in user, not just
-- admins) for SELECT on students/memberships/payments and for UPDATE on
-- payments — a pre-existing bug unrelated to the branch feature, fixed
-- here since these are exactly the policies that need branch-scoping
-- anyway.
-- ============================================================

-- students
DROP POLICY IF EXISTS "Admin can view all students" ON public.students;
CREATE POLICY "Admin can view all students" ON public.students
  FOR SELECT USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

DROP POLICY IF EXISTS "Admin can update any student" ON public.students;
CREATE POLICY "Admin can update any student" ON public.students
  FOR UPDATE
  USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()))
  WITH CHECK (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

-- memberships
DROP POLICY IF EXISTS "Admin can view all memberships" ON public.memberships;
CREATE POLICY "Admin can view all memberships" ON public.memberships
  FOR SELECT USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

DROP POLICY IF EXISTS "Admin can update memberships" ON public.memberships;
CREATE POLICY "Admin can update memberships" ON public.memberships
  FOR UPDATE
  USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()))
  WITH CHECK (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

-- payments
DROP POLICY IF EXISTS "Authenticated users can view all payments" ON public.payments;
CREATE POLICY "Admin can view all payments" ON public.payments
  FOR SELECT USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

DROP POLICY IF EXISTS "Authenticated users can update all payments" ON public.payments;
CREATE POLICY "Admin can update all payments" ON public.payments
  FOR UPDATE
  USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()))
  WITH CHECK (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

-- plans (the earlier standalone hotfix made this is_admin()-gated but not
-- yet branch-aware, since branch_id didn't exist at the time; tighten now)
DROP POLICY IF EXISTS "Admin can update plans" ON public.plans;
CREATE POLICY "Admin can update plans" ON public.plans
  FOR UPDATE
  USING (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()))
  WITH CHECK (is_admin() AND (admin_branch_id() IS NULL OR branch_id = admin_branch_id()));

-- ============================================================
-- 7. Seed Mahaveer Nagar / Kunhadi plan catalogs — confirmed with client:
-- both branches are single-floor/single-tier (no Basement/Ground Floor
-- split, no Prime tier), same shift/duration matrix as Vigyan Nagar's
-- Ground Floor. Ground Floor's current prices used as a placeholder
-- starting point — client will set real prices per branch afterward via
-- the (now branch-aware) admin "Update Prices" tab.
-- ============================================================
DO $$
DECLARE
  mn_id UUID;
  kh_id UUID;
BEGIN
  SELECT id INTO mn_id FROM public.branches WHERE name = 'Mahaveer Nagar';
  SELECT id INTO kh_id FROM public.branches WHERE name = 'Kunhadi';

  INSERT INTO public.plans (id, name, duration, shift, section, price, branch_id) VALUES
    ('mn-15days-morning-regular',    'Morning Shift', '15 Days',  'Morning',    'Regular', 300,  mn_id),
    ('mn-monthly-morning-regular',   'Morning Shift', '1 Month',  'Morning',    'Regular', 500,  mn_id),
    ('mn-3month-morning-regular',    'Morning Shift', '3 Months', 'Morning',    'Regular', 1200, mn_id),
    ('mn-15days-evening-regular',    'Evening Shift', '15 Days',  'Evening',    'Regular', 350,  mn_id),
    ('mn-monthly-evening-regular',   'Evening Shift', '1 Month',  'Evening',    'Regular', 600,  mn_id),
    ('mn-3month-evening-regular',    'Evening Shift', '3 Months', 'Evening',    'Regular', 1500, mn_id),
    ('mn-15days-fullday-regular',    'Full Day',      '15 Days',  'Full Day',   'Regular', 450,  mn_id),
    ('mn-monthly-fullday-regular',   'Full Day',      '1 Month',  'Full Day',   'Regular', 1000, mn_id),
    ('mn-3month-fullday-regular',    'Full Day',      '3 Months', 'Full Day',   'Regular', 2700, mn_id),
    ('mn-monthly-fullnight-regular', 'Full Night',    '1 Month',  'Full Night', 'Regular', 400,  mn_id),

    ('kh-15days-morning-regular',    'Morning Shift', '15 Days',  'Morning',    'Regular', 300,  kh_id),
    ('kh-monthly-morning-regular',   'Morning Shift', '1 Month',  'Morning',    'Regular', 500,  kh_id),
    ('kh-3month-morning-regular',    'Morning Shift', '3 Months', 'Morning',    'Regular', 1200, kh_id),
    ('kh-15days-evening-regular',    'Evening Shift', '15 Days',  'Evening',    'Regular', 350,  kh_id),
    ('kh-monthly-evening-regular',   'Evening Shift', '1 Month',  'Evening',    'Regular', 600,  kh_id),
    ('kh-3month-evening-regular',    'Evening Shift', '3 Months', 'Evening',    'Regular', 1500, kh_id),
    ('kh-15days-fullday-regular',    'Full Day',      '15 Days',  'Full Day',   'Regular', 450,  kh_id),
    ('kh-monthly-fullday-regular',   'Full Day',      '1 Month',  'Full Day',   'Regular', 1000, kh_id),
    ('kh-3month-fullday-regular',    'Full Day',      '3 Months', 'Full Day',   'Regular', 2700, kh_id),
    ('kh-monthly-fullnight-regular', 'Full Night',    '1 Month',  'Full Night', 'Regular', 400,  kh_id);
END $$;

COMMIT;

-- ============================================================
-- Rollback notes (not executed — for reference if this needs to be
-- reversed; the pre-migration state is also fully captured in
-- Documents/shiksha-library/db-backups/):
--
-- BEGIN;
-- DROP TABLE public.admins CASCADE;
-- DROP TABLE public.branches CASCADE;  -- also drops branch_id FKs via CASCADE... actually
--   -- FK columns aren't dropped by dropping the referenced table; drop them explicitly:
-- ALTER TABLE public.students    DROP COLUMN branch_id;
-- ALTER TABLE public.memberships DROP COLUMN branch_id;
-- ALTER TABLE public.payments    DROP COLUMN branch_id;
-- ALTER TABLE public.plans       DROP COLUMN branch_id;
-- DELETE FROM public.plans WHERE id LIKE 'mn-%' OR id LIKE 'kh-%';
-- -- then restore is_admin() to the old hardcoded-array version manually.
-- COMMIT;
-- ============================================================
