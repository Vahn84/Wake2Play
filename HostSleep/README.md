# HostSleep — Decky plugin

Sleep your Steam Remote Play **host PC** when the Steam Deck suspends, and wake it
(Wake-on-LAN) when the Deck resumes — **without closing the running game**.
Windows sleep keeps every process frozen in RAM, so the game is exactly where you
left it when the host wakes up.

Designed for **native Steam Remote Play** (not MoonDeck/Moonlight): Remote Play keeps
the game running when the stream disconnects, so suspend → wake → reconnect resumes
your session.

## How it works

| Deck event | Plugin action |
|---|---|
| Suspend (power button / lid / idle) | Sends a sleep command to the host **before** Wi-Fi drops |
| Resume | Sends WOL packets every 3 s for up to 60 s until the host's **Steam port (TCP 27036) answers** — i.e. the host is ready to stream — then reports the real outcome |

With **"Only when using Remote Play"** enabled (default), the suspend action only fires
if a Remote Play session is active (detected via Steam's `streaming_client` process),
and the resume action only fires if the host was slept by this plugin — so suspending
the Deck mid-local-game never touches your PC.

The sleep command targets [sleep-on-lan](https://github.com/SR-G/sleep-on-lan)
running on the host, in one of two modes (configurable in the plugin panel):

- **HTTP** (default): `GET http://<host>:8009/sleep`
- **UDP**: a magic packet built from the *reversed* MAC address, sent as a
  **broadcast**. Use this if your router isolates wireless from wired clients — such
  routers drop unicast between a wireless Deck and a wired host but still flood
  broadcast across, so HTTP unicast won't reach the host but the broadcast sleep and
  WOL wake both do.

Suspend/resume are detected through Steam's internal `SleepManager` module
(`RegisterForNotifyRequestSuspend` / `RegisterForNotifyResumeFromSuspend`). The older
`SteamClient.System.RegisterForOnSuspendRequest` API used by v0.5 no longer exists, which
is why v0.5's automation never fired. If neither API is found, the plugin toasts once at
load and the buttons keep working.

The panel's **Host PC** section shows live host status (Awake / Asleep) and the
**Wake host** / **Sleep host** buttons; both report the confirmed outcome, not just
"sent".

## Host PC setup (Windows)

1. Download [sleep-on-lan](https://github.com/SR-G/sleep-on-lan/releases) (`sol.exe`).
   Default config listens on UDP 9 (reversed-MAC) and HTTP 8009 — both work as-is.
   Strongly recommended: create a `sol.json` next to `sol.exe` enabling
   `AvoidDualUDPSending`, so duplicate sleep packets buffered across the suspend
   transition can never put the PC straight back to sleep on resume
   ([sleep-on-lan #22](https://github.com/SR-G/sleep-on-lan/issues/22)):

   ```json
   {
     "Listeners": ["UDP:9", "HTTP:8009"],
     "AvoidDualUDPSending": { "Active": true, "Delay": "400ms" }
   }
   ```
2. Run it at boot via Task Scheduler (its README suggests NSSM, which is abandoned —
   don't bother). From an **elevated** PowerShell:

   ```powershell
   $exe = "C:\Tools\sleep-on-lan\sol.exe"
   Register-ScheduledTask -TaskName "SleepOnLAN" `
     -Action (New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path $exe)) `
     -Trigger (New-ScheduledTaskTrigger -AtStartup) `
     -User "SYSTEM" -RunLevel Highest `
     -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
         -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1))
   Start-ScheduledTask -TaskName "SleepOnLAN"
   ```
3. Allow it through Windows Firewall (private network only — SYSTEM won't inherit any
   rule you accepted interactively for your own user):

   ```powershell
   New-NetFirewallRule -DisplayName "SleepOnLAN HTTP" -Direction Inbound -Protocol TCP -LocalPort 8009 -Profile Private -Action Allow
   New-NetFirewallRule -DisplayName "SleepOnLAN UDP" -Direction Inbound -Protocol UDP -LocalPort 9 -Profile Private -Action Allow
   ```
   These rules only apply while Windows considers the network **Private**. A new router or
   network is usually classified **Public**, which silently blocks sol. Check and fix with:

   ```powershell
   Get-NetConnectionProfile
   Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
   ```
4. Verify `http://<pc-ip>:8009/` answers from the LAN, then once more after a
   suspend/resume cycle.
5. Wake-on-LAN must already work (it does if MoonDeck wakes this PC): NIC power
   management → "Only allow a magic packet to wake the computer", wired Ethernet recommended.
6. A static IP is no longer required: the plugin re-learns the PC's IP from its name.

## Deck setup

1. Install the plugin (see Deploy below).
2. With the PC on, open the HostSleep panel in Decky (⋯ menu) and pick the PC from the
   **Host** dropdown — it lists Steam's own Remote Play hosts (Settings → Remote Play);
   with a single host it's picked automatically. The plugin resolves the name on the LAN
   (mDNS/LLMNR, stock SteamOS), reads the MAC from sleep-on-lan's status page (or the
   Deck's ARP table) and tells you if sleep-on-lan is missing. Manual MAC/IP/port live
   under **Advanced**; editing them by hand stops the automatic IP re-learning.
3. Use the **Test** buttons to verify both directions before trusting the automation:
   - "Sleep host now" → PC should suspend, game still running after manual wake.
   - "Wake host now" → PC should wake.

## Build

No toolchain: `dist/index.js` is `src/decky-runtime.js` (vendored @decky/api shim +
icon) concatenated with `src/plugin.js`. `deploy.sh` does it.

## Deploy to the Deck

Prereq: SSH key access to the Deck (`deck@steamdeck.local` by default).

```bash
./deploy.sh                      # or DECK_HOST=deck@<deck-ip> ./deploy.sh
```

Copies `main.py`, `package.json` and `dist/index.js` into the existing
`/home/deck/homebrew/plugins/HostSleep` (files there are owned by `deck`, no sudo needed)
and reloads the plugin through Steam's CEF debugger (`tools/cdp_eval.py`).

## Troubleshooting

- Plugin logs: `/home/deck/homebrew/logs/HostSleep/` on the Deck.
- Buttons stopped working after a router/network change → update the host IP in the
  panel, then check the Windows network profile (see Host setup step 3).
- Suspend fired but host didn't sleep → test `http://<host>:8009/sleep` from a browser
  on the LAN; check sol is running and the firewall rule.
- Host wakes but Remote Play doesn't auto-reconnect → known Steam quirk; reconnect
  from the Deck, the game is still running.
- Online games will drop their server connection while the host sleeps — that's
  inherent to sleeping the PC, not fixable client-side.

## Perimeter (ops notes)

- **Rollback / kill switch**: toggle off both behaviors in the panel, or uninstall the
  plugin from Decky. No host-side state beyond the sol service.
- **Testing**: manual Test buttons in the panel exercise the exact code paths the
  automation uses.
- **Security**: backend validates MAC/host formats before building packets/URLs; sol's
  HTTP endpoint is LAN-only — do not port-forward it.
- **Revisit if**: Steam renames the `SleepManager` notifications (the plugin toasts "hooks
  unavailable" at load; the log will lack "suspend hook fired" after a suspend), or the host moves to a
  network where UDP broadcast is filtered.
