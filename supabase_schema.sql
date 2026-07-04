-- 1. First, we drop (delete) the existing conflicting tables. 
-- Don't worry, this will just wipe the slate clean so we can start fresh!
DROP TABLE IF EXISTS missions CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS drone_missions CASCADE;
DROP TABLE IF EXISTS battery_allocations CASCADE;

-- (Optional) If you had a table named drone_recce_missions from the ChatGPT schema, drop it too:
DROP TABLE IF EXISTS drone_recce_missions CASCADE;

-- 2. Now, create the clean, correct tables that the React app expects:

CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  district text,
  aoi_geojson jsonb,
  parameters jsonb,
  selected_gun text,
  num_guns integer,
  num_batteries integer,
  bearing text,
  day_night text,
  season text,
  threat_level text,
  analysis_summary jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid,
  title text,
  generated_data jsonb,
  final_recommendation text,
  ranked_candidates jsonb,
  route_summary jsonb,
  risk_summary jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE drone_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid,
  candidate_id text,
  waypoints jsonb,
  route jsonb,
  status text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE battery_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid,
  battery_number integer,
  candidate_id text,
  status text,
  score numeric,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Auto-prune: keep only the newest N rows per table so the free tier can
--    never fill up. One generic trigger function handles every table (it reads
--    the table name + keep-count from the trigger itself). It runs
--    `security definer` so pruning works without granting the anon key delete
--    rights. Each table keeps its newest 100 rows; older ones are deleted on
--    every insert. Change the '100' below to keep more/fewer.

CREATE OR REPLACE FUNCTION public.prune_keep_newest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format(
    'delete from public.%I where id in ('
    || 'select id from public.%I order by created_at desc, id desc offset %s)',
    TG_TABLE_NAME, TG_TABLE_NAME, (TG_ARGV[0])::int
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_missions ON missions;
CREATE TRIGGER trg_prune_missions AFTER INSERT ON missions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prune_keep_newest('100');

DROP TRIGGER IF EXISTS trg_prune_reports ON reports;
CREATE TRIGGER trg_prune_reports AFTER INSERT ON reports
  FOR EACH STATEMENT EXECUTE FUNCTION public.prune_keep_newest('100');

DROP TRIGGER IF EXISTS trg_prune_drone_missions ON drone_missions;
CREATE TRIGGER trg_prune_drone_missions AFTER INSERT ON drone_missions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prune_keep_newest('100');

DROP TRIGGER IF EXISTS trg_prune_battery_allocations ON battery_allocations;
CREATE TRIGGER trg_prune_battery_allocations AFTER INSERT ON battery_allocations
  FOR EACH STATEMENT EXECUTE FUNCTION public.prune_keep_newest('100');
