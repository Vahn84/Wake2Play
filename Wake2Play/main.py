import asyncio
import json
import os
import re
import socket
import time
import urllib.request
from collections import deque

import decky

SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
# The plugin was called HostSleep before 1.0; adopt its settings on first run
LEGACY_SETTINGS_PATH = os.path.join(
    os.path.dirname(decky.DECKY_PLUGIN_SETTINGS_DIR), "HostSleep", "settings.json")

DEFAULTS = {
    # Steam's Remote Play name for the host (Settings → Remote Play). When set,
    # host_ip is re-learned from it, so a router handing out a new IP heals itself.
    "host_name": "",
    "mac": "",
    "host_ip": "",
    "broadcast_ip": "255.255.255.255",
    # "http" -> GET http://host:sleep_port/sleep (sleep-on-lan REST API)
    # "udp"  -> reversed-MAC magic packet (sleep-on-lan UDP listener)
    "sleep_mode": "http",
    "sleep_port": 8009,
    "wol_port": 9,
    "sleep_on_suspend": True,
    "wake_on_resume": True,
    # Gate on an active Remote Play client session: only sleep the host if the
    # Deck is streaming at suspend time, and only wake it if we slept it.
    "only_when_streaming": True,
    # After a confirmed wake, restart the Remote Play stream of the game that was
    # streaming when the Deck suspended (the game is still running on the host).
    "resume_stream": True,
    # Show the event log in the plugin panel and toast debug info on resume
    "debug": False,
}

MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
# Only plain IPs/hostnames may be interpolated into the sleep URL
HOST_RE = re.compile(r"^[A-Za-z0-9.\-]+$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}$")
# One line per interface on sol's status page (GET http://host:8009/)
SOL_HOST_RE = re.compile(r'<host ip="([0-9.]+)/\d+" mac="([0-9A-Fa-f:]{17})"')

# The host counts as awake when its Steam client accepts TCP on the Remote Play
# port. Unlike ping/ARP this can't be faked by a sleeping NIC's ARP offload, needs
# no root, and is allowed through the firewall wherever Remote Play works — and it
# means exactly what we care about: the host is ready to stream.
STEAM_PORT = 27036
PROBE_TIMEOUT_S = 1.0

# Wake is retry-until-acknowledged: WOL delivery to a sleeping NIC is not
# guaranteed and right after Deck resume Wi-Fi may still be reassociating.
WAKE_WINDOW_S = 60
WAKE_RETRY_S = 3.0
# How long the manual Sleep button waits for the host to actually go down.
SLEEP_VERIFY_S = 30
# Steam emits NotifyRequestSuspend twice per power-button press (~0.3 s apart,
# observed 2026-10-16). A second sleep command must not go out: sol can replay it
# on resume and put the host straight back to sleep (SR-G/sleep-on-lan #22).
SUSPEND_DEDUPE_S = 20
# After resume a docked Deck brings Wi-Fi up seconds before the dock's Ethernet;
# a stream restarted in that gap runs over Wi-Fi and dies when the default route
# switches to the cable (observed 2026-10-17). Wait this long, at most, for it.
WIRED_SETTLE_S = 25


def _parse_mac(mac):
    mac = (mac or "").strip()
    if not MAC_RE.match(mac):
        raise ValueError(f"Invalid MAC address: {mac!r}")
    return bytes(int(p, 16) for p in re.split("[:-]", mac))


def _magic_packet(mac_bytes):
    return b"\xff" * 6 + mac_bytes * 16


def _streaming_session():
    """The active Remote Play client session on the Deck, or None.

    Returns {"appid": int|None, "server": str|None} parsed from Steam's
    streaming_client argv (--appid 1971650 --server 192.168.1.10:27031).
    /proc/<pid>/comm truncates to 15 chars, so read cmdline and match the
    executable's basename against 'streaming_client'.
    """
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                argv = f.read().decode(errors="replace").split("\x00")
        except OSError:
            continue
        if os.path.basename(argv[0]) != "streaming_client":
            continue
        opts = dict(zip(argv, argv[1:]))
        appid = opts.get("--appid", "")
        return {"appid": int(appid) if appid.isdigit() else None,
                "server": opts.get("--server", "").rsplit(":", 1)[0] or None}
    return None


def _is_streaming():
    return _streaming_session() is not None


def _send_udp(packet, targets):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        for target in targets:
            sock.sendto(packet, target)
    finally:
        sock.close()


async def _host_awake(host):
    """True if the host's Steam port accepts a TCP connection."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, STEAM_PORT), PROBE_TIMEOUT_S)
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    return True


async def _resolve_name(name, timeout=2.0):
    """IPv4 of a LAN host by name, or None.

    Stock SteamOS resolves bare and .local names over mDNS/LLMNR, which Windows
    answers by default — no DNS server or static entry needed.
    """
    def lookup():
        names = [name] if name.endswith(".local") else [name, f"{name}.local"]
        for n in names:
            try:
                return socket.getaddrinfo(n, None, socket.AF_INET)[0][4][0]
            except OSError:
                continue
        return None
    try:
        return await asyncio.wait_for(asyncio.to_thread(lookup), timeout)
    except asyncio.TimeoutError:
        return None


def _sol_status(ip, port):
    """sleep-on-lan's XML status page, or None if sol isn't answering."""
    try:
        with urllib.request.urlopen(f"http://{ip}:{port}/", timeout=2) as resp:
            body = resp.read(65536).decode(errors="replace")
    except Exception:
        return None
    return body if "sleep-on-lan" in body else None


def _arp_mac(ip):
    """MAC for ip from the Deck's neighbour table, or None."""
    try:
        with open("/proc/net/arp") as f:
            for line in f.readlines()[1:]:
                cols = line.split()
                if cols[0] == ip and cols[2] != "0x0" and cols[3] != "00:00:00:00:00:00":
                    return cols[3]
    except OSError:
        pass
    return None


def _wired_with_route():
    """Wired NICs (en*/eth*) that currently hold an IPv4 default route."""
    try:
        with open("/proc/net/route") as f:
            return {c[0] for c in (l.split() for l in f.readlines()[1:])
                    if c[1] == "00000000" and c[0].startswith(("en", "eth"))}
    except OSError:
        return set()


class Plugin:
    def _dbg(self, msg):
        # Ring buffer surfaced in the panel's Debug section; always recorded
        # (cheap), only displayed when the debug toggle is on.
        self.debug_log.append(f"{time.strftime('%H:%M:%S')} {msg}")
        decky.logger.info(msg)

    async def _main(self):
        self.settings = dict(DEFAULTS)
        # Set when we sleep the host on suspend; gates the wake on resume.
        # In-memory only: the backend process survives Deck suspend.
        self.slept_host = False
        self.slept_appid = None  # game streaming when we slept the host
        self.docked = False  # Deck was on a wired connection when it suspended
        self.last_suspend = None  # monotonic time of the last handled suspend
        self.debug_log = deque(maxlen=100)
        path = SETTINGS_PATH
        if not os.path.exists(path) and os.path.exists(LEGACY_SETTINGS_PATH):
            path = LEGACY_SETTINGS_PATH
            decky.logger.info("adopting settings from HostSleep")
        try:
            with open(path) as f:
                stored = json.load(f)
            self.settings.update({k: stored[k] for k in DEFAULTS if k in stored})
        except FileNotFoundError:
            pass
        except (json.JSONDecodeError, OSError) as e:
            decky.logger.error("Failed to load settings, using defaults: %s", e)
        if path == LEGACY_SETTINGS_PATH:
            self._save()  # own copy, so removing HostSleep can't take them along
        self._dbg("plugin loaded (host=%s mac=%s mode=%s)" % (
            self.settings["host_ip"], self.settings["mac"],
            self.settings["sleep_mode"]))

    async def _unload(self):
        decky.logger.info("Wake2Play unloaded")

    # ---- settings ----------------------------------------------------

    async def get_settings(self):
        return self.settings

    async def save_settings(self, settings):
        self.settings.update({k: settings[k] for k in DEFAULTS if k in settings})
        return self._save()

    def _save(self):
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        with open(SETTINGS_PATH, "w") as f:
            json.dump(self.settings, f, indent=2)
        return self.settings

    async def is_streaming(self):
        return _is_streaming()

    async def get_debug_log(self):
        return list(self.debug_log)

    async def clear_debug_log(self):
        self.debug_log.clear()
        return []

    def _host(self):
        host = (self.settings["host_ip"] or "").strip()
        return host if HOST_RE.match(host) else ""

    async def host_status(self):
        """{"awake": bool} or {"awake": None} when no host IP is configured."""
        host = self._host()
        if host and await _host_awake(host):
            return {"awake": True}
        if await self._refresh_ip():
            return {"awake": await _host_awake(self._host())}
        return {"awake": False if host else None}

    async def _refresh_ip(self):
        """Re-learn host_ip from host_name; True if it changed."""
        name = (self.settings["host_name"] or "").strip()
        if not NAME_RE.match(name):
            return False
        ip = await _resolve_name(name, timeout=1.5)
        if not ip or ip == self.settings["host_ip"]:
            return False
        self._dbg(f"host {name} moved: {self.settings['host_ip']} -> {ip}")
        self.settings["host_ip"] = ip
        self._save()
        return True

    async def resolve_host(self, name):
        """Configure the host from its Steam name: learn IP and MAC.

        The host must be awake. MAC comes from sol's status page when sol is
        installed (also proving sleep will work), else from the Deck's ARP table.
        """
        name = (name or "").strip()
        if not NAME_RE.match(name):
            return {"ok": False, "error": f"Invalid host name: {name!r}"}
        ip = await _resolve_name(name)
        if not ip:
            return {"ok": False, "error": f"{name} not found on the network — is it on?"}
        port = int(self.settings["sleep_port"] or 8009)
        status = await asyncio.to_thread(_sol_status, ip, port)
        mac = next((m for i, m in SOL_HOST_RE.findall(status or "") if i == ip), None)
        if not mac:
            await _host_awake(ip)  # any traffic fills the ARP cache
            mac = _arp_mac(ip)
        if not mac:
            return {"ok": False, "error": f"Found {name} at {ip} but couldn't learn its MAC — is it on the same network?"}
        self.settings.update(host_name=name, host_ip=ip, mac=mac.upper())
        if status:
            self.settings["sleep_mode"] = "http"
        self._save()
        self._dbg(f"host set: {name} {ip} {mac} (sleep-on-lan {'found' if status else 'NOT found'})")
        return {"ok": True, "ip": ip, "mac": mac.upper(), "sol": bool(status)}

    # ---- suspend/resume hooks (respect the toggles) --------------------

    async def on_deck_suspend(self):
        self._dbg("suspend hook fired")
        # monotonic deliberately: it doesn't advance while the Deck sleeps, so the
        # stale suspend notification Steam re-delivers on wake reads as a repeat
        now = time.monotonic()
        if self.last_suspend is not None and now - self.last_suspend < SUSPEND_DEDUPE_S:
            self._dbg("suspend: duplicate notification, ignoring")
            return {"ok": True, "skipped": True, "reason": "duplicate"}
        self.last_suspend = now
        self.docked = bool(_wired_with_route())
        if not self.settings["sleep_on_suspend"]:
            self._dbg("suspend: sleep_on_suspend is off, skipping")
            return {"ok": True, "skipped": True, "reason": "disabled"}
        session = _streaming_session()
        self._dbg(f"suspend: Remote Play session {session or 'not found'}")
        if self.settings["only_when_streaming"] and not session:
            return {"ok": True, "skipped": True, "reason": "not streaming"}
        result = await self.sleep_host()
        self.slept_host = result.get("ok", False)
        self.slept_appid = session["appid"] if session and self.slept_host else None
        # Lets the UI put up the reconnect screen as soon as the Deck resumes
        if self.slept_appid and self.settings["resume_stream"]:
            result["resume_appid"] = self.slept_appid
        return result

    async def on_deck_resume(self):
        self._dbg("resume hook fired")
        if not self.settings["wake_on_resume"]:
            self._dbg("resume: wake_on_resume is off, skipping")
            return {"ok": True, "skipped": True, "reason": "disabled"}
        if self.settings["only_when_streaming"] and not self.slept_host:
            self._dbg("resume: host was not slept by us, skipping wake")
            return {"ok": True, "skipped": True, "reason": "host not slept by plugin"}
        self.slept_host = False
        appid, self.slept_appid = self.slept_appid, None
        result = await self.wake_host()
        if result.get("confirmed") and appid and self.settings["resume_stream"]:
            if _is_streaming():
                self._dbg("resume: stream already reconnected by itself")
            else:
                await self._wait_for_wired()
                result["resume_appid"] = appid
                self._dbg(f"resume: asking the UI to restart the stream of app {appid}")
        return result

    # ---- actions (unconditional; also used by the panel buttons) -------

    def _bcast_targets(self, ports):
        # Global broadcast, the configured broadcast, and the /24 directed
        # broadcast derived from the host IP — different routers flood different
        # broadcast forms, and some (client-isolating ones) only pass the directed
        # /24 form across the wireless/wired boundary, not global 255.255.255.255.
        bcasts = {"255.255.255.255", (self.settings["broadcast_ip"] or "255.255.255.255")}
        host = self._host()
        if host.count(".") == 3:
            bcasts.add(host.rsplit(".", 1)[0] + ".255")
        return [(b, p) for b in bcasts for p in ports]

    async def wake_host(self):
        try:
            mac_bytes = _parse_mac(self.settings["mac"])
        except ValueError as e:
            self._dbg(f"wake ERROR: {e}")
            return {"ok": False, "error": str(e)}
        packet = _magic_packet(mac_bytes)

        port = int(self.settings["wol_port"] or 9)
        # WOL magic packets are port-agnostic (the NIC scans the payload), so hit
        # 9 and 7; add the host unicast for non-isolating networks where that works.
        targets = self._bcast_targets({port, 7})
        host = self._host()
        if host:
            targets.append((host, port))

        started = time.monotonic()
        deadline = started + WAKE_WINDOW_S
        attempts = send_errors = 0
        confirmed = None if not host else False
        while time.monotonic() < deadline:
            if host and await _host_awake(host):
                confirmed = True
                break
            # The host may have come back on a new IP; re-learn it by name
            if host and attempts % 3 == 2 and await self._refresh_ip():
                host = self._host()
                continue
            attempts += 1
            try:
                _send_udp(packet, targets)
            except OSError as e:
                # Right after Deck resume Wi-Fi may still be reassociating;
                # sends fail transiently — keep the window open and retry.
                send_errors += 1
                self._dbg(f"wake: send failed (attempt {attempts}): {e}")
            if not host and attempts >= 8:
                break  # nothing to confirm against: a short blind burst
            await asyncio.sleep(WAKE_RETRY_S if host else 0.7)

        elapsed = round(time.monotonic() - started, 1)
        if confirmed:
            self._dbg(f"wake: host awake after {elapsed}s ({attempts} packets)")
            return {"ok": True, "confirmed": True, "elapsed_s": elapsed, "attempts": attempts}
        if attempts and send_errors == attempts:
            self._dbg(f"wake ERROR: every send failed across {elapsed}s")
            return {"ok": False, "error": "network unreachable for the whole wake window"}
        self._dbg(f"wake: NO confirmation after {elapsed}s ({attempts} packets, {send_errors} send errors)")
        return {"ok": True, "confirmed": confirmed, "elapsed_s": elapsed, "attempts": attempts}

    async def _wait_for_wired(self):
        """If we suspended docked, wait for the cable to get its route back."""
        if not self.docked:
            return
        started = time.monotonic()
        while time.monotonic() - started < WIRED_SETTLE_S:
            if _wired_with_route():
                await asyncio.sleep(1)  # let the route switch land
                self._dbg(f"resume: wired network back after {round(time.monotonic() - started, 1)}s")
                return
            await asyncio.sleep(0.5)
        self._dbg(f"resume: wired network NOT back after {WIRED_SETTLE_S}s, going ahead")

    async def sleep_host_verified(self):
        """Manual Sleep button: send the command, then watch the host go down."""
        host = self._host()
        if host and not await _host_awake(host):
            self._dbg("sleep: host already looks asleep, sending anyway")
        result = await self.sleep_host()
        if not result.get("ok") or not host:
            return result
        started = time.monotonic()
        while time.monotonic() - started < SLEEP_VERIFY_S:
            await asyncio.sleep(2)
            if not await _host_awake(host):
                elapsed = round(time.monotonic() - started, 1)
                self._dbg(f"sleep: host went down after {elapsed}s")
                return {"ok": True, "confirmed": True, "elapsed_s": elapsed}
        self._dbg(f"sleep: host STILL awake after {SLEEP_VERIFY_S}s")
        return {"ok": True, "confirmed": False, "elapsed_s": SLEEP_VERIFY_S}

    async def sleep_host(self):
        await self._refresh_ip()
        if self.settings["sleep_mode"] == "udp":
            return await self._sleep_udp()
        return await self._sleep_http()

    async def _sleep_http(self):
        host = self._host()
        if not host:
            return {"ok": False, "error": "Host IP is not set or invalid"}
        url = f"http://{host}:{int(self.settings['sleep_port'] or 8009)}/sleep"

        def _get():
            with urllib.request.urlopen(url, timeout=3) as resp:
                return resp.status

        try:
            status = await asyncio.to_thread(_get)
        except Exception as e:
            self._dbg(f"sleep ERROR: {url} -> {e}")
            return {"ok": False, "error": f"sleep-on-lan not reachable ({e})"}

        self._dbg(f"sleep: {url} -> HTTP {status}")
        return {"ok": True}

    async def _sleep_udp(self):
        try:
            mac = _parse_mac(self.settings["mac"])
        except ValueError as e:
            self._dbg(f"sleep ERROR: {e}")
            return {"ok": False, "error": str(e)}

        # sleep-on-lan convention: magic packet built from the REVERSED MAC.
        # Sent to the BROADCAST address (not the host's unicast IP): routers that
        # isolate wireless from wired clients drop unicast between them but still
        # flood layer-2 broadcast across, so broadcast reliably reaches a wired
        # host from a wireless client. This mirrors how WOL wake already works.
        packet = _magic_packet(mac[::-1])
        port = int(self.settings["wol_port"] or 9)
        # sol listens on UDP 9 and 7 by default; broadcast to both across every
        # broadcast form (see _bcast_targets).
        targets = self._bcast_targets({port, 7})
        try:
            # Exactly ONE send, unlike the wake burst: extra sleep packets are
            # buffered through the suspend transition and sol replays them on
            # resume, putting the host straight back to sleep (SR-G/sleep-on-lan
            # #22). The host NIC is awake here, so delivery doesn't need
            # redundancy; a lost packet just leaves the host awake.
            _send_udp(packet, targets)
        except OSError as e:
            self._dbg(f"sleep ERROR: send failed: {e}")
            return {"ok": False, "error": str(e)}

        self._dbg(f"sleep: sent reversed-MAC broadcast to {targets}")
        return {"ok": True}
