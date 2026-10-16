const manifest = {"name":"HostSleep"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

var DefaultContext = {
  color: undefined,
  size: undefined,
  className: undefined,
  style: undefined,
  attr: undefined
};
var IconContext = SP_REACT.createContext && /*#__PURE__*/SP_REACT.createContext(DefaultContext);

var _excluded = ["attr", "size", "title"];
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), true).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function Tree2Element(tree) {
  return tree && tree.map((node, i) => /*#__PURE__*/SP_REACT.createElement(node.tag, _objectSpread({
    key: i
  }, node.attr), Tree2Element(node.child)));
}
function GenIcon(data) {
  return props => /*#__PURE__*/SP_REACT.createElement(IconBase, _extends({
    attr: _objectSpread({}, data.attr)
  }, props), Tree2Element(data.child));
}
function IconBase(props) {
  var elem = conf => {
    var attr = props.attr,
      size = props.size,
      title = props.title,
      svgProps = _objectWithoutProperties(props, _excluded);
    var computedSize = size || conf.size || "1em";
    var className;
    if (conf.className) className = conf.className;
    if (props.className) className = (className ? className + " " : "") + props.className;
    return /*#__PURE__*/SP_REACT.createElement("svg", _extends({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, conf.attr, attr, svgProps, {
      className: className,
      style: _objectSpread(_objectSpread({
        color: props.color || conf.color
      }, conf.style), props.style),
      height: computedSize,
      width: computedSize,
      xmlns: "http://www.w3.org/2000/svg"
    }), title && /*#__PURE__*/SP_REACT.createElement("title", null, title), props.children);
  };
  return IconContext !== undefined ? /*#__PURE__*/SP_REACT.createElement(IconContext.Consumer, null, conf => elem(conf)) : elem(DefaultContext);
}

// THIS FILE IS AUTO GENERATED
function FaBed (props) {
  return GenIcon({"attr":{"viewBox":"0 0 640 512"},"child":[{"tag":"path","attr":{"d":"M176 256c44.11 0 80-35.89 80-80s-35.89-80-80-80-80 35.89-80 80 35.89 80 80 80zm352-128H304c-8.84 0-16 7.16-16 16v144H64V80c0-8.84-7.16-16-16-16H16C7.16 64 0 71.16 0 80v352c0 8.84 7.16 16 16 16h32c8.84 0 16-7.16 16-16v-48h512v48c0 8.84 7.16 16 16 16h32c8.84 0 16-7.16 16-16V240c0-61.86-50.14-112-112-112z"},"child":[]}]})(props);
}

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
