# ROS2 Stage 25D coordinator

Run from the project root with `node server/relay-server.cjs`.

The coordinator uses only Node built-ins. It serves `/health` and accepts WebSocket clients at `/ws`. Stage 25D adds two-client replay readiness, digest/hash confirmation, disconnect closure, match-complete agreement, and same-room rematch voting/draft restart.
