# Changelog

## 1.0.7 (final) — 2026-10-21
In-game menu entries switched off. They worked, but Decky's own injectFCTrampoline stubs and
restores React's SP_JSX.jsx around every trampolined render (traced with a setter trap), which
undid our wrap constantly; keeping it alive (1 s re-install) was followed by Decky's panel
failing to render and NonSteamLaunchers failing to load, fixed by a Steam restart and a Decky
update (cause not separated). Using Decky's trampoline on the menu component instead left
Steam's UI black when the component threw outside its providers. Both rejected; the panel now
has Disconnect & sleep PC next to Disconnect. Game-page button unaffected.
tests: after restart all 20 plugins load, SP_JSX.jsx untouched; panel buttons deployed

## 1.0.7 — 2026-10-21
The game-page Wake/Sleep button was unreachable with the D-pad (it sat in a separate DOM
layer) and was a text button. It is now a square icon button (bed = Sleep PC, power = Wake PC)
in the hero banner's top-right, built the way MoonDeck builds its moon (anchor row between hero
and overview, absolutely positioned Focusable > Button with Steam's own MenuButton class), so it
is focusable the same way. It looks for MoonDeck's button at render time: if present, ours sits
10 px to its left, level and same look; if not, ours takes that corner. Also hides while the hero
is shown full screen, and the in-game-menu hook now logs when it is installed/removed/replaced.
Selected, the icon turned white on Steam's white focus background and vanished (a Steam rule
forces icon fill white); our icon now turns dark like the neighbouring buttons'. With MoonDeck
installed the two buttons were separate focus groups and only ours was reachable — user is
removing MoonDeck, so coexistence wasn't fixed.
Wake PC never showed while the PC slept: Steam lists a game's host only while it's online.
The plugin now remembers which games are installed on the PC (Steam's "installed" flag for
the host — first version counted every owned game, 381; now 21 = the PC's 19 manifests + 2
non-Steam shortcuts), refreshed whenever it sees the PC awake (load, after wake, panel open),
with a "Games on the PC" entry and a Refresh button (wakes the PC first if needed). The power
icon is an outline again when not selected.
tests: on the Deck — button sits in the same React parent as MoonDeck's anchor, 48x48 at x=1352
next to MoonDeck's at 1410; with MoonDeck's button hidden it moves to 1410; faked asleep host
shows the power icon + "Wake PC" label; none on a Deck-only game. D-pad reach and look need eyes

## 1.0.6 — 2026-10-21
Disconnect and wake/sleep without leaving Steam's own screens. While streaming, the in-game
Steam menu gets **Disconnect (keep game running)** and **Disconnect & sleep PC** above
"Exit game" (Steam's own entry, so it looks and navigates like the rest). On the library
page of any game that lives on the Remote Play host, a **Wake PC** / **Sleep PC** button
sits at the right end of the Play row (Wake when the host is asleep, Sleep when it is awake
and not streaming). The page uses Decky's routerHook; the in-game menu has no hook, so the
plugin recognises Steam's menu component and wraps it. Every patch is fail-safe (errors
return Steam's untouched output, a missing target is logged once, all undone on unload) and
the panel has a "Show buttons in Steam's menus" switch (default on).
tests: on the Deck — plugin loads, patches install; synthetic menu column in a detached React
root gets both items only while streaming, none when the switch is off or the exit entry is
missing (logged once); real game page shows Sleep PC on the host game and nothing on a
Deck-only game or with the switch off. Not yet pressed on the Deck: the items/buttons
themselves, and the look/navigation of the real in-game menu

## 1.0.5 — 2026-10-21
A controller turned on mid-stream never reached the running game (it joins as the next
player and no reorder, on the Deck or the PC, reaches the game; only a fresh stream does).
The plugin now asks "play with it as player 1?" when a controller connects during a stream;
Yes moves it first and restarts the stream in ~3 s with the game still running. A
controller turning off offers the same restart; the panel has a manual button too, and a
**Disconnect (keep game running)** button — Steam on the Deck only offers "Exit game", which quits it.
The first attempt closed the stream gracefully and the host quit the game (lost progress);
the stream is now cut without a goodbye (SIGKILL), which the host treats as a dropped
connection, and a new stream is requested at once (the host drops the old session on it).
tests: live on the Deck with Octopath: force-stop kept the game (same PID, host logged no
stop), restart back in 3 s; join prompt → Steam Controller player 1; leave prompt checked;
Disconnect → resumed the same session from the library

## 1.0.4 — 2026-10-21
The player-slot check now runs only for 2 minutes after each wake instead of every 2 s
all the time: the gap only opens while the Deck sleeps, and the wake window covers the
host waking and the stream restarting.
tests: gap made with no wake → left alone; real sleep/wake → P2→P1 right after resume, logged

## 1.0.3 — 2026-10-21
Deck controls dead in the game after a night's sleep: Steam doesn't move controllers up
when one leaves, so once the Steam Controller turned off the Deck's own controls stayed
player 2 with player 1 empty, and the restarted stream kept that order (Steam menus worked,
the game didn't; "Rearrange controller order" was the only way out). Wake2Play now checks
every 2 s and closes any gap with the same swap Steam's rearrange screen uses (toggle
"Keep player 1 filled", on by default), and logs the controller order at suspend and resume.
tests: gap made on the Deck → moved back to P1 within 2 s and logged; the swap was also
confirmed mid-stream (game took the Deck controls); overnight case pending

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
