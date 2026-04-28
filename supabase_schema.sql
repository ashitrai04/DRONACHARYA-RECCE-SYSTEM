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
