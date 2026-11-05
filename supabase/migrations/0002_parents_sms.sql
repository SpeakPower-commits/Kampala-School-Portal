-- =============================================================================
-- 0002_parents_sms.sql — the parent portal and SMS.
--
-- Apply after 0001_init.sql: Dashboard → SQL Editor → paste → Run.
-- =============================================================================

-- ── A second guardian per learner ────────────────────────────────────────────
-- Either guardian can sign in to the parent portal and receive SMS. The
-- learners_guard trigger in 0001 already protects this column from bursars
-- and coaches, because it compares whole rows.
alter table public.learners add column guardian2_phone text not null default '';
