-- Rollback for TEMPLATE UPGRADE v11 (calendar activities).
--
-- WARNING: this DROPS the calendar_activities table, so every activity
-- created since v11 is permanently lost. Export it first if it matters:
--   COPY (SELECT * FROM public.calendar_activities) TO STDOUT WITH CSV HEADER;
-- (or Supabase Table Editor -> calendar_activities -> Export to CSV).
--
-- Nothing else is touched: clients, jobs, payments and notes are unchanged.
-- The app keeps working after the rollback — the Calendar simply shows
-- scheduled jobs only and the Activities sections say the update is needed.
-- Job status names live in the settings table ('job_status_labels'); to go
-- back to the default names delete that one row:
--   DELETE FROM public.settings WHERE key = 'job_status_labels';
BEGIN;
DROP TABLE IF EXISTS public.calendar_activities;
DROP INDEX IF EXISTS public.jobs_id_client_id_key;
COMMIT;
NOTIFY pgrst, 'reload schema';
