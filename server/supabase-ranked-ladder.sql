-- ROS2 Stage 25S durable Ranked ladder storage.
-- Run once in the Supabase SQL Editor.

create table if not exists public.ros2_ranked_ladder (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ros2_ranked_ladder enable row level security;

-- No public policies are required. The ROS2 coordinator writes with the
-- Supabase service-role key, which must remain a server-side Render secret.
