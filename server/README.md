# ROS2 Stage 25U coordinator — verified Ranked persistence

Stage 25U hardens the Supabase-backed Ranked ladder after testing exposed a dangerous failure mode: a Ranked result could appear in the live coordinator memory even if the durable Supabase write failed, then disappear after a Render Free spin-down.

## Required hosted configuration

Render Free web services use an **ephemeral filesystem**. On Render Free, Ranked is now **fail-closed**. A Ranked room cannot be created or joined unless durable storage has been loaded and verified. Render local files are ephemeral and are not accepted as durable Ranked storage.

Run `server/supabase-ranked-ladder.sql` once in the Supabase SQL Editor, then configure the `ros2-coordinator` Render service with:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

`SUPABASE_SERVICE_ROLE_KEY` is still accepted for backward compatibility and may contain either a legacy service_role JWT or a current `sb_secret_...` key. `SUPABASE_SECRET_KEY` is the preferred current name. Never expose the service-role key or current secret key in the static client or GitHub.

New `sb_secret_...` keys are sent to Supabase using the `apikey` header. Legacy JWT service-role keys continue to use `apikey` plus `Authorization: Bearer ...`.

## Verification

Every Ranked result now uses a **write + read-back verification** before the coordinator tells clients that the durable ladder update succeeded. The snapshot carries a monotonically increasing `persistenceRevision`. If the remote copy does not match the local revision/record counts, storage is marked unhealthy and further Ranked entry is blocked until the coordinator restarts with working storage.

The coordinator retries a failed durable write three times before reporting a storage failure. Casual multiplayer remains available.

Check:

```text
https://ros2-coordinator.onrender.com/health
```

A healthy hosted setup should include values equivalent to:

```json
{
  "rankedPersistence": {
    "mode": "supabase",
    "required": true,
    "durable": true,
    "remoteHealthy": true,
    "verified": true,
    "error": null
  }
}
```

`/rankings` now also includes a `persistence` object. The in-game **VIEW RANKINGS** modal displays the same storage state so a local-only ladder can no longer look healthy.

## Endpoints

- `/health` — coordinator + Ranked persistence diagnostics
- `/rankings` — public Ranked ladder, champion analytics, and persistence state
- `/ws` — multiplayer WebSocket endpoint

## Local development

Local development does not require Supabase by default. To exercise fail-closed behavior locally, set:

```text
ROS2_REQUIRE_DURABLE_RANKED=true
```

A paid Render persistent disk remains supported with `ROS2_LADDER_DURABLE_FILE=true` only when the configured ladder path actually resides on that persistent disk.
