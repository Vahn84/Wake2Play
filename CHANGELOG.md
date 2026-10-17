# Changelog

## 1.0.2 — 2026-10-17
Reconnect screen cut the cover off in handheld mode: its content was 546 px tall on a
534 px (1280×800 @1.5×) screen, mostly Steam's spinner, which ignores size props and
lays out at 140 px. Cover, title and gaps now scale with screen height and the spinner
is zoomed down; the whole dialog measures 437 px at handheld sizes.
tests: measured on the Deck at handheld-equivalent sizes; not yet seen in handheld

## 1.0.1 — 2026-10-17
Stream reconnect broke when the host was already awake: the stream restarted over Wi-Fi
3 s after resume and died 2 s later when the dock's Ethernet came up and took the route.
If the Deck suspended docked, wait (≤25 s) for the cable's route before restarting; and
only count a stream as reconnected after it has held 5 s, retrying once if it drops.
tests: parse check + wired detection verified on the Deck; real cycle pending

## 1.0.0 — 2026-10-16
Renamed HostSleep → Wake2Play. Installed through Decky's own installer (the plugin folder
is root-owned); settings are adopted from HostSleep on first run and saved under the new
name, then HostSleep was uninstalled. `deploy.sh` now also builds `build/Wake2Play.zip`.
tests: install + settings adoption verified on the Deck

## 0.9.0 — 2026-10-16
Zero-config host setup: a Host dropdown lists Steam's own Remote Play hosts; picking one
(automatic when there's only one) resolves its IP by name and its MAC from sleep-on-lan,
and flags a missing sleep-on-lan. The IP is re-learned from the name whenever it moves,
so router changes heal themselves. Manual fields moved under Advanced.
tests: resolve/heal/not-found exercised live on the Deck; panel confirmed by user

## 0.8.1 — 2026-10-16
Reconnect screen showed a broken cover image: it opens before the network is back after
resume. Now uses Steam's local library-art cache first, then the online URL, and hides
the picture if neither loads.
tests: real cycle green

## 0.8.0 — 2026-10-16
Shows a blocking reconnect screen on resume: the game's cover, "Reconnecting to <game>",
a spinner and live status (waking host → waiting for the game → starting the stream),
with Cancel (or B) to abort, including a stream launch already handed to Steam.
tests: real cycle green (cover image broken → 0.8.1)

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
