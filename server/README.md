# ROS2 Stage 25S coordinator

Run from the project root with:

```bash
node server/relay-server.cjs
```

The coordinator serves:

- `/health` — coordinator health/status, including Ranked persistence status
- `/rankings` — public Ranked ladder + champion analytics JSON
- `/ws` — multiplayer WebSocket endpoint

Stage 25S fixes Ranked standings disappearing after a hosted coordinator restart/spin-down. The local JSON ladder is still kept as a development/backup file, but hosted Free Render deployments should use the durable Supabase snapshot backend described below.

## Why the old ladder disappeared on Render Free

Render Free web services use an **ephemeral filesystem**. When the coordinator spins down, restarts, or redeploys, runtime changes to `server/data/ranked-ladder.json` are lost. A Free service can spin down after roughly 15 minutes without inbound HTTP/WebSocket traffic, so a ladder can appear to work and then be empty the next time the service wakes.

A paid Render service can instead use a persistent disk. For a Free coordinator, Stage 25S supports Supabase over its HTTPS REST API using Node's built-in `fetch`, so no extra npm dependency is required.

## Recommended Free Render setup — Supabase

1. Create a Supabase project.
2. Open **SQL Editor** and run `server/supabase-ranked-ladder.sql`.
3. In Supabase, copy the Project URL and the **service_role** key.
4. In the Render `ros2-coordinator` service, add these environment variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Optional overrides:

```text
ROS2_LADDER_SUPABASE_TABLE=ros2_ranked_ladder
ROS2_LADDER_SUPABASE_ROW=main
```

**Never expose the service-role key in the static client or GitHub.** It belongs only in the Render coordinator environment.

On startup the coordinator loads the ladder from Supabase before accepting Ranked results. Every verified Ranked result is then written to the normal local JSON file and synchronously mirrored to Supabase before the server broadcasts `ranked_match_recorded`.

If Supabase is configured but cannot be loaded safely on startup, creation of new Ranked rooms is blocked with `RANKED_STORAGE_UNAVAILABLE` instead of risking overwriting or silently losing standings.

Check:

```text
https://ros2-coordinator.onrender.com/health
```

A correctly configured Free deployment should report a Ranked persistence object with:

```json
{"mode":"supabase","durable":true,"remoteHealthy":true}
```

## Paid Render persistent-disk option

You can still use a paid Render persistent disk instead of Supabase:

```text
Persistent Disk mount: /var/data
ROS2_LADDER_FILE=/var/data/ros2-ranked-ladder.json
ROS2_LADDER_DURABLE_FILE=true
```

Only set `ROS2_LADDER_DURABLE_FILE=true` when that path really is backed by a persistent disk.

## Rating model

- Initial rating: `1500`
- Elo K-factor: `32`
- Each team size has an independent rating.
- Ranked records use W-D-L; draws score `0.5` in Elo.
- Champion W-D-L analytics are tracked independently by team size.
