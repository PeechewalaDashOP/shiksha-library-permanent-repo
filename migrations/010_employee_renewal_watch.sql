-- 010_employee_renewal_watch.sql
--
-- Per request: employees should also see who's membership has already expired or is
-- expiring soon — so they can inform students to renew — but NOT rejected/pending/queued
-- memberships (those aren't "expiring", they never became a real active membership to begin
-- with, or a renewal is already queued and doesn't need a reminder). No phone number, same
-- as everywhere else in the employee dashboard.
--
-- Mirrors admin.html's "Memberships Expiring Soon" widget (status='active', sorted by
-- end_date ascending) but widened to also include already-expired ones, since the point here
-- is "who needs a reminder", not just "who's about to lapse".

BEGIN;

CREATE OR REPLACE FUNCTION public.employee_renewal_watch()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  student_code TEXT,
  plan_name TEXT,
  end_date DATE,
  days_left INT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.full_name, s.student_code, p.name, m.end_date,
    (m.end_date - CURRENT_DATE)::int AS days_left
  FROM public.students s
  JOIN LATERAL (
    SELECT * FROM public.memberships mm
    WHERE mm.student_id = s.id
      AND mm.status = 'active'
    ORDER BY mm.created_at DESC
    LIMIT 1
  ) m ON true
  LEFT JOIN public.plans p ON p.id = m.plan_id
  WHERE public.is_employee()
    AND s.branch_id = public.employee_branch_id()
    AND m.end_date <= CURRENT_DATE + 7  -- already overdue (any amount) OR due within 7 days
  ORDER BY m.end_date ASC
  LIMIT 200;
$function$;

GRANT EXECUTE ON FUNCTION public.employee_renewal_watch() TO authenticated;

COMMIT;

-- Verification (as a logged-in employee):
-- SELECT * FROM employee_renewal_watch(); -- oldest-overdue first, then soonest-to-expire
