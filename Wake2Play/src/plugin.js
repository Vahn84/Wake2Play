// ---- Wake2Play plugin (hand-maintained; no build step) ----------------------

const getSettings = callable("get_settings");
const saveSettings = callable("save_settings");
const wakeHost = callable("wake_host");
const sleepHostVerified = callable("sleep_host_verified");
const hostStatus = callable("host_status");
const resolveHost = callable("resolve_host");
const onDeckSuspend = callable("on_deck_suspend");
const onDeckResume = callable("on_deck_resume");
const isStreaming = callable("is_streaming");
const getDebugLog = callable("get_debug_log");
const clearDebugLog = callable("clear_debug_log");
const logEvent = callable("log_event");
const toast = (body) => toaster.toast({ title: "Wake2Play", body });
function describeWake(res) {
    if (!res.ok)
        return `Wake failed: ${res.error}`;
    if (res.skipped)
        return `Wake skipped (${res.reason ?? "no reason"})`;
    if (res.confirmed === true)
        return `Host is awake (${res.elapsed_s}s)`;
    if (res.confirmed === false)
        return `Wake sent, but host not up after ${res.elapsed_s}s`;
    return "Wake packets sent (set the host IP to confirm)";
}
function describeSleep(res) {
    if (!res.ok)
        return `Sleep failed: ${res.error}`;
    if (res.confirmed === true)
        return `Host is asleep (${res.elapsed_s}s)`;
    if (res.confirmed === false)
        return `Sleep sent, but host still awake after ${res.elapsed_s}s — is sleep-on-lan running and allowed through the firewall?`;
    return "Sleep command sent";
}
function statusLabel(awake) {
    if (awake === undefined)
        return "checking…";
    if (awake === null)
        return "set the host IP below";
    return awake ? "🟢 Awake" : "⚫ Asleep / off";
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const STREAM_START_TIMEOUT_MS = 45000;
// A stream only counts as reconnected once it has stayed up this long: right
// after resume one can start and die within seconds (network still settling).
const STREAM_STABLE_MS = 5000;
// Full-screen reconnect dialog. It is driven from outside (the resume hook) via
// a small controller: ctl.set(patch) re-renders, ctl.cancelled is set by the
// Cancel button or B, and ctl.close() dismisses it.
function ReconnectModal({ ctl }) {
    const [st, setSt] = SP_REACT.useState(ctl.state);
    // Try each cover candidate in turn; drop the picture if none loads
    const [imgIdx, setImgIdx] = SP_REACT.useState(0);
    const image = st.images[imgIdx];
    SP_REACT.useEffect(() => { ctl.listener = setSt; return () => { ctl.listener = null; }; }, []);
    const failed = st.phase === "failed";
    return SP_JSX.jsx(DFL.ModalRoot, { bAllowFullSize: true, onCancel: () => ctl.cancel(),
        // Sized off the viewport height: the Deck's own screen is only ~534 CSS px
        // tall (1280x800 at 1.5x), and fixed sizes pushed the cover off the top.
        children: SP_JSX.jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "min(18px, 2.4vh)", padding: "min(12px, 1.5vh) 0", textAlign: "center" }, children: [
                image && SP_JSX.jsx("img", { src: image, onError: () => setImgIdx((i) => i + 1), style: { height: "min(220px, 30vh)", borderRadius: "6px", boxShadow: "0 6px 24px rgba(0,0,0,.6)" } }),
                SP_JSX.jsx("div", { style: { fontSize: "min(24px, 3.8vh)", fontWeight: "bold" }, children: failed ? `Couldn't reconnect to ${st.name}` : `Reconnecting to ${st.name}` }),
                // SteamSpinner ignores size props and always lays out at ~140px; zoom
                // shrinks its layout box too (transform wouldn't)
                !failed && SP_JSX.jsx("div", { style: { zoom: 0.45 }, children: SP_JSX.jsx(DFL.SteamSpinner, {}) }),
                SP_JSX.jsx("div", { style: { fontSize: "16px", opacity: 0.8 }, children: st.status }),
                SP_JSX.jsx(DFL.DialogButton, { style: { width: "240px" }, onClick: () => ctl.cancel(), children: failed ? "Close" : "Cancel" }),
            ] }) });
}
function openReconnectModal(appid) {
    const overview = window.appStore?.GetAppOverviewByAppID(appid);
    // Cover art: Steam's local library cache first (relative /assets/... URLs on
    // steamloopback.host, served from disk) — right after resume the network is
    // usually still down, so the online URL alone shows a broken image.
    const images = [];
    try {
        images.push(...(window.appStore.GetCachedVerticalCapsuleURL(overview) ?? []));
    }
    catch { }
    try {
        images.push(window.appStore.GetVerticalCapsuleURLForApp(overview));
    }
    catch { }
    const ctl = {
        state: { phase: "waking", name: overview?.display_name ?? `app ${appid}`, images: images.filter(Boolean), status: "Waking the host PC…" },
        listener: null, cancelled: false, closed: false, handle: null,
        set(patch) { this.state = { ...this.state, ...patch }; this.listener?.(this.state); },
        close() { if (!this.closed) { this.closed = true; this.handle?.Close(); } },
        cancel() {
            const wasFailed = this.state.phase === "failed";
            this.cancelled = true;
            // A launch already handed to Steam is aborted the way Steam's own
            // prelaunch dialogs do it.
            if (this.state.phase === "launching")
                SteamClient.Streaming.CancelStreamGame();
            this.close();
            if (!wasFailed)
                toast("Reconnection cancelled — the host stays awake");
        },
        fail(status) { this.set({ phase: "failed", status }); },
    };
    ctl.handle = DFL.showModal(SP_JSX.jsx(ReconnectModal, { ctl }));
    return ctl;
}
// Restart the Remote Play stream of appid, exactly like the library's Stream
// button (SteamClient.Apps.StreamGame(appid, hostClientId, -1)). Steam on the
// Deck rediscovers the woken host a few seconds after it's reachable, so wait
// until it lists the game as running (display_status 4) on a remote client,
// then until the stream process is actually up.
async function resumeStream(appid, ctl) {
    const overview = () => window.appStore?.GetAppOverviewByAppID(appid);
    ctl.set({ phase: "waiting", status: "Host is awake — waiting for Steam to see the game…" });
    let client = null;
    for (let i = 0; i < 30 && !client && !ctl.cancelled; i++) {
        client = (overview()?.per_client_data ?? []).find((c) => c.clientid !== "0" && c.display_status === 4);
        if (!client)
            await delay(1000);
    }
    if (ctl.cancelled)
        return;
    if (!client)
        return ctl.fail("The game isn't showing as running on the host — start the stream manually.");
    for (let attempt = 1; attempt <= 2 && !ctl.cancelled; attempt++) {
        console.log("Wake2Play: StreamGame", appid, client.clientid, client.client_name, "attempt", attempt);
        ctl.set({ phase: "launching", status: attempt === 1 ? `Starting the stream from ${client.client_name}…` : "The stream dropped — trying again…" });
        SteamClient.Apps.StreamGame(appid, client.clientid, -1);
        let upSince = null;
        const deadline = Date.now() + STREAM_START_TIMEOUT_MS;
        while (Date.now() < deadline && !ctl.cancelled) {
            if (await isStreaming()) {
                upSince ??= Date.now();
                if (Date.now() - upSince >= STREAM_STABLE_MS)
                    return ctl.close();
            }
            else if (upSince !== null)
                break; // came up, then died: retry
            await delay(1000);
        }
        if (upSince === null)
            break; // never came up at all: retrying blind won't help
        console.log("Wake2Play: stream dropped after starting");
        await delay(2000);
    }
    if (!ctl.cancelled)
        ctl.fail("The stream didn't start — try streaming it from the library.");
}
// Remote Play hosts Steam itself has found on the LAN — the same list as
// Settings → Remote Play. Hosts carry a clientId; paired client devices that
// stream FROM this Deck carry a deviceId instead and are left out.
function getSteamHosts() {
    try {
        const store = DFL.findModuleExport((m) => m && typeof m === "object" && "m_clientCaps" in m && "m_devices" in m);
        return [...(store?.m_devices ?? [])]
            .filter((d) => d.clientId && d.clientName)
            .map((d) => ({ name: d.clientName, online: d.status === "Connected" }));
    }
    catch (e) {
        console.error("Wake2Play: Remote Play host list unavailable:", e);
        return [];
    }
}
// Steam doesn't move controllers up when one leaves: after the Steam Controller
// turns off (typically overnight), the Deck's own controls stay player 2 with
// player 1 empty, so a streamed game that reads player 1 ignores them, and the
// stream restart after wake keeps that order. Close the gaps the way Steam's own
// "Rearrange controller order" screen moves a controller: a swap with the empty slot.
function playerSlots() {
    return (window.ControllerStore?.GetControllersSorted?.() ?? [])
        .filter((c) => Number.isInteger(c.nXInputIndex) && c.nXInputIndex >= 0)
        .sort((a, b) => a.nXInputIndex - b.nXInputIndex);
}
const describeSlots = (slots) => slots.map((c) => `P${c.nXInputIndex + 1} ${c.strName}`).join(", ") || "none";
function fillPlayerSlots() {
    // Ascending order: every target slot is already empty when its swap happens.
    const moves = [];
    playerSlots().forEach((c, want) => {
        if (c.nXInputIndex !== want) {
            SteamClient.Input.SwapControllerOrder(c.nXInputIndex, want);
            moves.push(`${c.strName} P${c.nXInputIndex + 1}→P${want + 1}`);
        }
    });
    return moves;
}
// Only after a wake: the gap opens while the Deck sleeps, and controllers keep
// (re)connecting while the host wakes and the stream restarts.
const SLOT_WATCH_MS = 120000;
function watchPlayerSlots(ms = SLOT_WATCH_MS) {
    let busy = false;
    const tick = async () => {
        if (busy || !playerSlots().some((c, i) => c.nXInputIndex !== i))
            return;
        busy = true;
        try {
            if ((await getSettings()).fill_player_slots) {
                const moves = fillPlayerSlots();
                if (moves.length)
                    logEvent(`controllers: moved ${moves.join(", ")}`);
            }
        }
        catch (e) {
            console.error("Wake2Play: player slot fill failed:", e);
        }
        finally {
            busy = false;
        }
    };
    const timer = setInterval(tick, 2000);
    const stop = setTimeout(() => clearInterval(timer), ms);
    tick();
    return () => { clearInterval(timer); clearTimeout(stop); };
}
function Content() {
    const [settings, setSettings] = SP_REACT.useState(null);
    const [streaming, setStreaming] = SP_REACT.useState(null);
    const [awake, setAwake] = SP_REACT.useState(undefined);
    const [busy, setBusy] = SP_REACT.useState(null);
    const [debugLog, setDebugLog] = SP_REACT.useState([]);
    const [hosts] = SP_REACT.useState(getSteamHosts);
    const [solFound, setSolFound] = SP_REACT.useState(null);
    const [advanced, setAdvanced] = SP_REACT.useState(false);
    const pickHost = async (name) => {
        setBusy("pick");
        try {
            const res = await resolveHost(name);
            if (!res.ok)
                return toast(res.error);
            setSolFound(res.sol);
            setSettings(await getSettings());
            toast(res.sol ? `${name} set up` : `${name} found, but sleep-on-lan isn't answering on it — Sleep won't work until it's installed`);
        }
        finally {
            setBusy(null);
            hostStatus().then((r) => setAwake(r.awake));
        }
    };
    SP_REACT.useEffect(() => {
        getSettings().then((s) => {
            setSettings(s);
            if (s.debug)
                void getDebugLog().then(setDebugLog);
            // Zero-config: exactly one host on the LAN and none chosen yet
            const online = hosts.filter((h) => h.online);
            if (!s.host_name && online.length === 1)
                void pickHost(online[0].name);
        });
        isStreaming().then(setStreaming);
        // Live host status while the panel is open
        let alive = true;
        const poll = () => hostStatus().then((r) => alive && setAwake(r.awake));
        poll();
        const timer = setInterval(poll, 4000);
        return () => { alive = false; clearInterval(timer); };
    }, []);
    if (!settings) {
        return SP_JSX.jsx(DFL.PanelSection, { title: "Loading..." });
    }
    const update = (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        void saveSettings(next);
    };
    const run = async (which, start, fn, describe) => {
        setBusy(which);
        toast(start);
        try {
            toast(describe(await fn()));
        }
        finally {
            setBusy(null);
            hostStatus().then((r) => setAwake(r.awake));
            if (settings.debug)
                void getDebugLog().then(setDebugLog);
        }
    };
    const row = (child) => SP_JSX.jsx(DFL.PanelSectionRow, { children: child });
    return SP_JSX.jsxs(SP_JSX.Fragment, { children: [
            SP_JSX.jsxs(DFL.PanelSection, { title: "Host PC", children: [
                    hosts.length === 0 && !settings.host_name
                        ? row(SP_JSX.jsx(DFL.Field, { label: "No Remote Play hosts found", description: "Turn on the PC and make sure Steam is running on it" }))
                        : row(SP_JSX.jsx(DFL.DropdownItem, { label: "Host", disabled: busy !== null,
                            description: busy === "pick" ? "Looking it up…"
                                : settings.host_ip ? `${settings.host_ip} · ${settings.mac}` + (solFound === false ? " · sleep-on-lan missing" : "") : "Pick your gaming PC",
                            rgOptions: (hosts.some((h) => h.name === settings.host_name) || !settings.host_name ? hosts : [...hosts, { name: settings.host_name, online: false }])
                                .map((h) => ({ data: h.name, label: h.online ? h.name : `${h.name} (offline)` })),
                            selectedOption: settings.host_name || null,
                            onChange: (opt) => void pickHost(opt.data) })),
                    row(SP_JSX.jsx(DFL.Field, { label: "Status", children: statusLabel(awake) })),
                    row(SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy !== null,
                        onClick: () => void run("wake", "Waking host…", wakeHost, describeWake),
                        children: busy === "wake" ? "Waking…" : "Wake host" })),
                    row(SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy !== null,
                        onClick: () => void run("sleep", "Putting host to sleep…", sleepHostVerified, describeSleep),
                        children: busy === "sleep" ? "Sleeping…" : "Sleep host" })),
                ] }),
            SP_JSX.jsxs(DFL.PanelSection, { title: "Automation", children: [
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Sleep host when Deck suspends", checked: settings.sleep_on_suspend, onChange: (v) => update({ sleep_on_suspend: v }) })),
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Wake host when Deck resumes", checked: settings.wake_on_resume, onChange: (v) => update({ wake_on_resume: v }) })),
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Only when using Remote Play",
                        description: "Sleep only if a Remote Play session is active; wake only if the host was slept by this plugin." +
                            (streaming === null ? "" : ` Remote Play now: ${streaming ? "active" : "none"}`),
                        checked: settings.only_when_streaming, onChange: (v) => update({ only_when_streaming: v }) })),
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Keep player 1 filled", description: "For 2 minutes after each wake, move controllers up so player 1 is never left empty (Steam leaves a gap when a controller turned off)", checked: settings.fill_player_slots, onChange: (v) => update({ fill_player_slots: v }) })),
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Reconnect the stream after wake", description: "Restart Remote Play of the game you were streaming once the host is back", checked: settings.resume_stream, onChange: (v) => update({ resume_stream: v }) })),
                ] }),
            SP_JSX.jsxs(DFL.PanelSection, { title: "Advanced", children: [
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Show manual host settings", description: "Only needed if the host isn't in the list above", checked: advanced, onChange: setAdvanced })),
                    advanced && row(SP_JSX.jsx(DFL.TextField, { label: "MAC address", description: "e.g. AA:BB:CC:DD:EE:FF", value: settings.mac, onChange: (e) => update({ mac: e.target.value, host_name: "" }) })),
                    advanced && row(SP_JSX.jsx(DFL.TextField, { label: "IP address", description: "Static IP or DHCP reservation recommended", value: settings.host_ip, onChange: (e) => update({ host_ip: e.target.value, host_name: "" }) })),
                    advanced && row(SP_JSX.jsx(DFL.DropdownItem, { label: "Sleep command", rgOptions: [
                            { data: "http", label: "HTTP (sleep-on-lan REST)" },
                            { data: "udp", label: "UDP reversed-MAC packet" },
                        ], selectedOption: settings.sleep_mode, onChange: (opt) => update({ sleep_mode: opt.data }) })),
                    advanced && settings.sleep_mode === "http" && row(SP_JSX.jsx(DFL.TextField, { label: "sleep-on-lan HTTP port", value: String(settings.sleep_port), onChange: (e) => {
                            const port = parseInt(e.target.value, 10);
                            if (!isNaN(port))
                                update({ sleep_port: port });
                        } })),
                ] }),
            SP_JSX.jsxs(DFL.PanelSection, { title: "Debug", children: [
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Debug mode", description: "Show the event log below and toast every suspend/resume decision", checked: settings.debug, onChange: (v) => {
                            update({ debug: v });
                            if (v)
                                void getDebugLog().then(setDebugLog);
                        } })),
                    settings.debug && SP_JSX.jsxs(SP_JSX.Fragment, { children: [
                            row(SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => void getDebugLog().then(setDebugLog), children: "Refresh log" })),
                            row(SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => void clearDebugLog().then(setDebugLog), children: "Clear log" })),
                            row(SP_JSX.jsx("div", { style: {
                                    fontSize: "11px",
                                    fontFamily: "monospace",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all",
                                    userSelect: "text",
                                    maxHeight: "260px",
                                    overflowY: "auto",
                                }, children: debugLog.length === 0
                                    ? "(log is empty)"
                                    : [...debugLog].reverse().join("\n") })),
                        ] }),
                ] }),
        ] });
}
// Steam moved suspend/resume notifications off SteamClient.System into an
// internal SleepManager module (the old RegisterForOnSuspendRequest /
// RegisterForOnResumeFromSuspend are gone — that is why v0.5 never fired).
// Prefer SleepManager; keep the old API as a fallback for older clients.
function registerSuspendHooks(onSuspend, onResume) {
    let sleepManager = null;
    try {
        sleepManager = DFL.findModuleExport((m) => m?.RegisterForNotifyRequestSuspend && m?.RegisterForNotifyResumeFromSuspend);
    }
    catch (e) {
        console.error("Wake2Play: SleepManager lookup failed:", e);
    }
    if (sleepManager) {
        return [
            sleepManager.RegisterForNotifyRequestSuspend(onSuspend),
            sleepManager.RegisterForNotifyResumeFromSuspend(onResume),
        ];
    }
    const sys = window.SteamClient?.System;
    if (sys?.RegisterForOnSuspendRequest && sys?.RegisterForOnResumeFromSuspend) {
        return [sys.RegisterForOnSuspendRequest(onSuspend), sys.RegisterForOnResumeFromSuspend(onResume)];
    }
    return null;
}
var index = definePlugin(() => {
    let resuming = false;
    let stopSlotWatch = null; // the post-wake player slot check, while it runs
    let suspendedAppid = null; // game streaming when we slept the host
    const regs = registerSuspendHooks(async () => {
        logEvent(`controllers at suspend: ${describeSlots(playerSlots())}`);
        try {
            const res = await onDeckSuspend();
            // Second (duplicate) notification must not clear the first's appid
            if (!res.skipped)
                suspendedAppid = res.resume_appid ?? null;
            if (!res.ok)
                console.error("Wake2Play: sleep on suspend failed:", res.error);
        }
        catch (e) {
            console.error("Wake2Play: suspend hook error:", e);
        }
    }, async () => {
        if (resuming)
            return; // one wake loop at a time
        resuming = true;
        logEvent(`controllers at resume: ${describeSlots(playerSlots())}`);
        stopSlotWatch?.();
        stopSlotWatch = watchPlayerSlots();
        // Up immediately, before the (up to 60 s) wake, so the user isn't left
        // poking at a library with no stream
        const ctl = suspendedAppid ? openReconnectModal(suspendedAppid) : null;
        suspendedAppid = null;
        try {
            const res = await onDeckResume();
            const settings = await getSettings();
            if (ctl && !ctl.cancelled) {
                if (res.resume_appid)
                    await resumeStream(res.resume_appid, ctl);
                else if (!res.ok || res.confirmed === false)
                    ctl.fail(describeWake(res));
                else
                    ctl.close(); // stream came back by itself
            }
            // Failures and no-confirmation are actionable even outside debug mode
            else if (!res.ok || res.confirmed === false)
                toast(describeWake(res));
            else if (settings.debug)
                toaster.toast({ title: "Wake2Play debug", body: describeWake(res) });
        }
        catch (e) {
            console.error("Wake2Play: resume hook error:", e);
            ctl?.fail(`Something went wrong: ${e}`);
        }
        finally {
            resuming = false;
        }
    });
    if (!regs)
        toast("Suspend/resume hooks unavailable in this Steam version — automation is off, buttons still work");
    return {
        name: "Wake2Play",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Wake2Play" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(FaBed, {}),
        onDismount() {
            regs?.forEach((r) => r?.unregister?.());
            stopSlotWatch?.();
        },
    };
});

export { index as default };
