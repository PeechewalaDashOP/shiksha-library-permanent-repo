-- 005_employee_dashboard.sql
--
-- New "Employee" role — like an admin, but locked to exactly one branch (branch_id NOT NULL,
-- unlike admins where NULL means "sees all") and restricted to exactly two capabilities:
-- editing a plan's price, and updating a student's photo/Aadhaar images.
--
-- Postgres RLS restricts which ROWS a policy allows, not which COLUMNS — a plain UPDATE grant
-- on `plans` scoped to their branch would let an employee change a plan's name, duration, or
-- deactivate it entirely, not just its price. So employees get NO direct table UPDATE grants
-- at all; every write goes through a narrow SECURITY DEFINER function that touches exactly the
-- columns named in this file and nothing else. Same reasoning for reads: employees don't get
-- broad SELECT on `students` (which would expose phone/email/Aadhaar number/payment history via
-- a direct REST call even if the UI never shows it) — they get a search function that returns
-- only the columns needed to find the right student (name, phone, code, photo/Aadhaar urls).
--
-- Storage (student-photos bucket): no new policies needed — existing policies already allow
-- any authenticated user to upload/read from it (same trust level students/admins already
-- have), so employees work there without changes. The restriction that matters — which
-- student record a photo gets attached to — is enforced by employee_update_student_photo below.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employees (
  email TEXT PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access employees" ON public.employees
  FOR ALL USING (auth.role() = 'service_role');

-- ── ROLE CHECK FUNCTIONS (identical pattern to is_admin()/admin_branch_id()) ────────────
CREATE OR REPLACE FUNCTION public.is_employee()
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.employees e ON e.email = u.email
    WHERE u.id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.employee_branch_id()
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.branch_id FROM auth.users u
  JOIN public.employees e ON e.email = u.email
  WHERE u.id = auth.uid();
$function$;

GRANT EXECUTE ON FUNCTION public.is_employee() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_branch_id() TO authenticated;

-- ── POWER 1: edit a plan's price, own branch only ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_update_plan_price(p_plan_id TEXT, p_new_price NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  plan_branch UUID;
BEGIN
  IF NOT public.is_employee() THEN
    RAISE EXCEPTION 'Not an employee';
  END IF;
  IF p_new_price IS NULL OR p_new_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  SELECT branch_id INTO plan_branch FROM public.plans WHERE id = p_plan_id;
  IF plan_branch IS NULL OR plan_branch <> public.employee_branch_id() THEN
    RAISE EXCEPTION 'Plan not found in your branch';
  END IF;

  UPDATE public.plans SET price = p_new_price WHERE id = p_plan_id;
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.employee_update_plan_price(TEXT, NUMERIC) TO authenticated;

-- ── POWER 2: update a student's photo/Aadhaar images, own branch only ───────────────────
-- Each url param is optional (NULL = leave that column unchanged) so the caller only needs
-- to pass the one(s) actually being replaced.
CREATE OR REPLACE FUNCTION public.employee_update_student_photo(
  p_student_id UUID,
  p_photo_url TEXT DEFAULT NULL,
  p_aadhar_front_url TEXT DEFAULT NULL,
  p_aadhar_back_url TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  student_branch UUID;
BEGIN
  IF NOT public.is_employee() THEN
    RAISE EXCEPTION 'Not an employee';
  END IF;
  IF p_photo_url IS NULL AND p_aadhar_front_url IS NULL AND p_aadhar_back_url IS NULL THEN
    RAISE EXCEPTION 'Nothing to update';
  END IF;

  SELECT branch_id INTO student_branch FROM public.students WHERE id = p_student_id;
  IF student_branch IS NULL OR student_branch <> public.employee_branch_id() THEN
    RAISE EXCEPTION 'Student not found in your branch';
  END IF;

  UPDATE public.students SET
    photo_url        = COALESCE(p_photo_url, photo_url),
    aadhar_front_url = COALESCE(p_aadhar_front_url, aadhar_front_url),
    aadhar_back_url  = COALESCE(p_aadhar_back_url, aadhar_back_url)
  WHERE id = p_student_id;
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.employee_update_student_photo(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── Search, own branch only, limited columns only ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_search_students(p_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  phone TEXT,
  student_code TEXT,
  photo_url TEXT,
  aadhar_front_url TEXT,
  aadhar_back_url TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id, s.full_name, s.phone, s.student_code, s.photo_url, s.aadhar_front_url, s.aadhar_back_url
  FROM public.students s
  WHERE public.is_employee()
    AND s.branch_id = public.employee_branch_id()
    AND (s.full_name ILIKE '%' || p_query || '%' OR s.phone ILIKE '%' || p_query || '%')
  ORDER BY s.full_name
  LIMIT 20;
$function$;

GRANT EXECUTE ON FUNCTION public.employee_search_students(TEXT) TO authenticated;

-- ── Plans list for the price-edit screen, own branch only ───────────────────────────────
-- Plans SELECT is already public (anyone can read plan prices — needed for the booking page),
-- so no new read policy is needed here; employee.html just queries plans directly filtered by
-- employee_branch_id(), same as the booking page filters by a selected branch id.

COMMIT;

-- Verification (run after commit, while NOT logged in as an employee — should error "Not an
-- employee" via the RLS-equivalent check inside the function, not silently succeed):
-- SELECT employee_update_plan_price('some-plan-id', 999);
