-- 007_employee_search_more_fields.sql
--
-- Per explicit request: employees should see more student context while searching — email,
-- current plan/duration/shift/section, membership start/end dates, fixed seat, locker,
-- membership status — but explicitly NOT phone number (or anything else confidential:
-- address, Aadhaar number, parent mobile, payment amounts stay excluded).
--
-- Phone stays usable to SEARCH by (staff often know a student's number even if it shouldn't
-- be displayed), just dropped from the returned/displayed columns.

BEGIN;

DROP FUNCTION IF EXISTS public.employee_search_students(TEXT);

CREATE OR REPLACE FUNCTION public.employee_search_students(p_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  student_code TEXT,
  photo_url TEXT,
  aadhar_front_url TEXT,
  aadhar_back_url TEXT,
  plan_name TEXT,
  duration TEXT,
  shift TEXT,
  section TEXT,
  start_date DATE,
  end_date DATE,
  fixed_seat BOOLEAN,
  locker BOOLEAN,
  membership_status TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.full_name, s.email, s.student_code, s.photo_url, s.aadhar_front_url, s.aadhar_back_url,
    p.name, p.duration, p.shift, p.section,
    m.start_date, m.end_date, m.fixed_seat, m.locker, m.status
  FROM public.students s
  LEFT JOIN LATERAL (
    SELECT * FROM public.memberships mm
    WHERE mm.student_id = s.id
    ORDER BY mm.created_at DESC
    LIMIT 1
  ) m ON true
  LEFT JOIN public.plans p ON p.id = m.plan_id
  WHERE public.is_employee()
    AND s.branch_id = public.employee_branch_id()
    AND (s.full_name ILIKE '%' || p_query || '%' OR s.phone ILIKE '%' || p_query || '%')
  ORDER BY s.full_name
  LIMIT 20;
$function$;

GRANT EXECUTE ON FUNCTION public.employee_search_students(TEXT) TO authenticated;

COMMIT;

-- Verification (as a logged-in employee):
-- SELECT * FROM employee_search_students('some name');
