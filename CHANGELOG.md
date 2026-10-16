# Changelog

## 0.8.0 — 2026-10-16
Shows a blocking reconnect screen on resume: the game's cover, "Reconnecting to <game>",
a spinner and live status (waking host → waiting for the game → starting the stream),
with Cancel (or B) to abort, including a stream launch already handed to Steam.
tests: parse check + load on Deck; real cycle pending

## 0.7.0 — 2026-10-16
Reconnects the Remote Play stream after wake: the streamed game is read from Steam's
streaming process at suspend and restarted via the library's own Stream call once the
host is back. Verified end to end on the Deck (Octopath, host woke in 11 s).
tests: manual cycle green

## 0.6.1 — 2026-10-16
Ignores Steam's duplicate suspend notification (fires twice per press), so only one
sleep command goes out; sleep mode switched to HTTP now that the host firewall allows it.
tests: manual cycle green

## 0.6.0 — 2026-10-16
Automation finally fires: hooks Steam's SleepManager instead of the removed
`SteamClient.System` suspend API. Wake/sleep confirmed via the host's Steam port
instead of a root-only raw socket; status and buttons moved to the top of the panel.
tests: manual cycle green
