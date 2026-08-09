-- 004_student_code_unique_per_branch.sql
--
-- Follow-up to 003: the user wants Mahaveer Nagar/Kunhadi codes in the exact same short
-- format as Vigyan Nagar (e.g. "GM-2026-001"), with no branch-abbreviation marker — accepting
-- that a code like "GE-2026-001" could exist identically in two different branches,
-- distinguishable only by which branch's dashboard/receipt it's on, not by the code itself.
--
-- 1) student_code's UNIQUE constraint was global (one code, period). Change it to unique only
--    within its own branch, so the same short code can exist once per branch.
-- 2) generate_student_code() no longer prefixes a branch abbreviation. Vigyan Nagar keeps its
--    existing global sequence unchanged; Mahaveer Nagar/Kunhadi keep their own independent
--    per-branch counters (from 003) but the codes they produce now look identical in format
--    to Vigyan Nagar's.

BEGIN;

ALTER TABLE public.students DROP CONSTRAINT students_student_code_key;
ALTER TABLE public.students ADD CONSTRAINT students_branch_code_unique UNIQUE (branch_id, student_code);

CREATE OR REPLACE FUNCTION public.generate_student_code(p_branch_id UUID, p_shift_prefix TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  next_val INTEGER;
  year_val TEXT;
  branch_name TEXT;
BEGIN
  year_val := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata')::TEXT;

  SELECT name INTO branch_name FROM public.branches WHERE id = p_branch_id;

  IF branch_name IS NULL OR branch_name = 'Vigyan Nagar' THEN
    -- Unchanged: Vigyan Nagar's existing global sequence.
    next_val := nextval('student_code_counter');
  ELSE
    INSERT INTO public.branch_student_counters (branch_id, counter)
    VALUES (p_branch_id, 1)
    ON CONFLICT (branch_id) DO UPDATE SET counter = public.branch_student_counters.counter + 1
    RETURNING counter INTO next_val;
  END IF;

  RETURN COALESCE(NULLIF(p_shift_prefix, ''), 'SL') || '-' || year_val || '-' || LPAD(next_val::TEXT, 3, '0');
END;
$function$;

COMMIT;

-- Verification (run after commit):
-- SELECT generate_student_code((SELECT id FROM branches WHERE name = 'Mahaveer Nagar'), 'GE'); -- expect GE-2026-001
-- SELECT generate_student_code((SELECT id FROM branches WHERE name = 'Kunhadi'), 'GM');         -- expect GM-2026-001
-- (remember to reset branch_student_counters back to 0 for both after testing — the SELECT above consumes a real number)
