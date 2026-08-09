-- 003_per_branch_student_codes.sql
--
-- generate_student_code() used a single global sequence (student_code_counter) shared
-- across ALL branches — so Mahaveer Nagar's first-ever registration got "GE-2026-104",
-- continuing Vigyan Nagar's running count instead of starting fresh at 01.
--
-- Fix: Vigyan Nagar keeps using the existing global sequence, completely unchanged (no
-- disruption to its running numbering or existing code format). Mahaveer Nagar and Kunhadi
-- each get their own independent counter starting at 1, with a branch-abbreviation prefix
-- (MN-/KH-) so codes stay globally unique (student_code has a UNIQUE constraint — without a
-- branch marker, both branches' "01" would collide).
--
-- Signature change: generate_student_code() -> generate_student_code(p_branch_id, p_shift_prefix)
-- Now returns the COMPLETE code (was: just the "SL-YYYY-NNN" tail that callers then
-- string-manipulated to prepend a shift prefix). Centralizing this in the DB function means
-- the numbering logic — and its atomicity — lives in exactly one place.

BEGIN;

CREATE TABLE IF NOT EXISTS public.branch_student_counters (
  branch_id UUID PRIMARY KEY REFERENCES public.branches(id),
  counter INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.branch_student_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access branch_student_counters" ON public.branch_student_counters
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO public.branch_student_counters (branch_id)
SELECT id FROM public.branches WHERE name IN ('Mahaveer Nagar', 'Kunhadi')
ON CONFLICT (branch_id) DO NOTHING;

DROP FUNCTION IF EXISTS public.generate_student_code();

CREATE OR REPLACE FUNCTION public.generate_student_code(p_branch_id UUID, p_shift_prefix TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  next_val INTEGER;
  year_val TEXT;
  branch_name TEXT;
  branch_abbr TEXT := '';
BEGIN
  year_val := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata')::TEXT;

  SELECT name INTO branch_name FROM public.branches WHERE id = p_branch_id;

  IF branch_name IS NULL OR branch_name = 'Vigyan Nagar' THEN
    -- Unchanged behavior: Vigyan Nagar's existing global sequence, unprefixed format.
    next_val := nextval('student_code_counter');
  ELSE
    branch_abbr := CASE branch_name
      WHEN 'Mahaveer Nagar' THEN 'MN'
      WHEN 'Kunhadi' THEN 'KH'
      ELSE upper(left(branch_name, 2))
    END;

    INSERT INTO public.branch_student_counters (branch_id, counter)
    VALUES (p_branch_id, 1)
    ON CONFLICT (branch_id) DO UPDATE SET counter = public.branch_student_counters.counter + 1
    RETURNING counter INTO next_val;
  END IF;

  RETURN (CASE WHEN branch_abbr <> '' THEN branch_abbr || '-' ELSE '' END)
       || COALESCE(NULLIF(p_shift_prefix, ''), 'SL') || '-' || year_val || '-' || LPAD(next_val::TEXT, 3, '0');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_student_code(UUID, TEXT) TO authenticated, anon, service_role;

COMMIT;

-- Verification (run after commit):
-- SELECT generate_student_code((SELECT id FROM branches WHERE name = 'Mahaveer Nagar'), 'GE'); -- expect MN-GE-2026-001
-- SELECT generate_student_code((SELECT id FROM branches WHERE name = 'Kunhadi'), 'GM');         -- expect KH-GM-2026-001
-- SELECT generate_student_code((SELECT id FROM branches WHERE name = 'Vigyan Nagar'), 'GE');    -- expect GE-2026-105 (continues existing count)
