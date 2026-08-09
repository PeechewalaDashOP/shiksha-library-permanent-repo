-- 006_employee_admin_ui.sql
--
-- Supports self-service employee management from admin.html (each branch's admin can add/
-- remove their own branch's employees without going through a manual dev-run script).
--
-- Adds auth_user_id to employees so the delete flow (netlify/functions/manage-employee.js)
-- can directly target the Supabase Auth user to remove, without an email-lookup round-trip
-- (supabase-js's auth.admin.listUsers() has no email filter) — mirrors students.auth_user_id.

BEGIN;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS auth_user_id UUID;

COMMIT;
