// ---- HostSleep plugin (hand-maintained; no build step) ----------------------

const getSettings = callable("get_settings");
const saveSettings = callable("save_settings");
const wakeHost = callable("wake_host");
const sleepHostVerified = callable("sleep_host_verified");
const hostStatus = callable("host_status");
const onDeckSuspend = callable("on_deck_suspend");
const onDeckResume = callable("on_deck_resume");
const isStreaming = callable("is_streaming");
const getDebugLog = callable("get_debug_log");
const clearDebugLog = callable("clear_debug_log");
const toast = (body) => toaster.toast({ title: "HostSleep", body });
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
// Restart the Remote Play stream of appid, exactly like the library's Stream
// button (SteamClient.Apps.StreamGame(appid, hostClientId, -1)). Steam on the
// Deck rediscovers the woken host a few seconds after it's reachable, so wait
// until it lists the game as running (display_status 4) on a remote client.
async function resumeStream(appid) {
    const overview = () => window.appStore?.GetAppOverviewByAppID(appid);
    const name = overview()?.display_name ?? `app ${appid}`;
    toast(`Reconnecting to ${name}…`);
    let client = null;
    for (let i = 0; i < 30 && !client; i++) {
        client = (overview()?.per_client_data ?? []).find((c) => c.clientid !== "0" && c.display_status === 4);
        if (!client)
            await delay(1000);
    }
    if (!client) {
        toast(`${name} isn't showing as running on the host — start the stream manually`);
        return;
    }
    console.log("HostSleep: StreamGame", appid, client.clientid, client.client_name);
    SteamClient.Apps.StreamGame(appid, client.clientid, -1);
}
function Content() {
    const [settings, setSettings] = SP_REACT.useState(null);
    const [streaming, setStreaming] = SP_REACT.useState(null);
    const [awake, setAwake] = SP_REACT.useState(undefined);
    const [busy, setBusy] = SP_REACT.useState(null);
    const [debugLog, setDebugLog] = SP_REACT.useState([]);
    SP_REACT.useEffect(() => {
        getSettings().then((s) => {
            setSettings(s);
            if (s.debug)
                void getDebugLog().then(setDebugLog);
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
                    row(SP_JSX.jsx(DFL.ToggleField, { label: "Reconnect the stream after wake", description: "Restart Remote Play of the game you were streaming once the host is back", checked: settings.resume_stream, onChange: (v) => update({ resume_stream: v }) })),
                ] }),
            SP_JSX.jsxs(DFL.PanelSection, { title: "Host settings", children: [
                    row(SP_JSX.jsx(DFL.TextField, { label: "MAC address", description: "e.g. AA:BB:CC:DD:EE:FF", value: settings.mac, onChange: (e) => update({ mac: e.target.value }) })),
                    row(SP_JSX.jsx(DFL.TextField, { label: "IP address", description: "Static IP or DHCP reservation recommended", value: settings.host_ip, onChange: (e) => update({ host_ip: e.target.value }) })),
                    row(SP_JSX.jsx(DFL.DropdownItem, { label: "Sleep command", rgOptions: [
                            { data: "http", label: "HTTP (sleep-on-lan REST)" },
                            { data: "udp", label: "UDP reversed-MAC packet" },
                        ], selectedOption: settings.sleep_mode, onChange: (opt) => update({ sleep_mode: opt.data }) })),
                    settings.sleep_mode === "http" && row(SP_JSX.jsx(DFL.TextField, { label: "sleep-on-lan HTTP port", value: String(settings.sleep_port), onChange: (e) => {
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
        console.error("HostSleep: SleepManager lookup failed:", e);
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
    const regs = registerSuspendHooks(async () => {
        try {
            const res = await onDeckSuspend();
            if (!res.ok)
                console.error("HostSleep: sleep on suspend failed:", res.error);
        }
        catch (e) {
            console.error("HostSleep: suspend hook error:", e);
        }
    }, async () => {
        if (resuming)
            return; // one wake loop at a time
        resuming = true;
        try {
            const res = await onDeckResume();
            const settings = await getSettings();
            // Failures and no-confirmation are actionable even outside debug mode
            if (!res.ok || res.confirmed === false)
                toast(describeWake(res));
            else if (settings.debug)
                toaster.toast({ title: "HostSleep debug", body: describeWake(res) });
            if (res.resume_appid)
                await resumeStream(res.resume_appid);
        }
        catch (e) {
            console.error("HostSleep: resume hook error:", e);
        }
        finally {
            resuming = false;
        }
    });
    if (!regs)
        toast("Suspend/resume hooks unavailable in this Steam version — automation is off, buttons still work");
    return {
        name: "HostSleep",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "HostSleep" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(FaBed, {}),
        onDismount() {
            regs?.forEach((r) => r?.unregister?.());
        },
    };
});

export { index as default };
