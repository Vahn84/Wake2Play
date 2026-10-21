// ---- Buttons in Steam's own menus (hand-maintained; no build step) ----------
// deploy.sh concatenates decky-runtime.js + menus.js + plugin.js into one module,
// so this file uses plugin.js's helpers (disconnectStream, wakeHost, toast, ...) by
// name; they are only touched when a patch runs, long after everything has loaded.
//
// Two patches, both opt-out through the "Show buttons in Steam's menus" setting:
//   1. In-game Steam menu: two items above "Exit game", only while streaming.
//   2. Library game page: Wake PC / Sleep PC next to the Play row.
//
// Fail-safe, the top requirement: every callback below catches its own errors and
// hands back Steam's untouched output, targets are feature-detected, a missing
// target is logged once and leaves Steam alone, and everything is undone on
// unload or when the setting is turned off.

const loggedOnce = new Set();
function warnOnce(key, msg) {
    if (loggedOnce.has(key))
        return;
    loggedOnce.add(key);
    console.warn("Wake2Play menus:", msg);
    try {
        Promise.resolve(logEvent(`menus: ${msg}`)).catch(() => { });
    }
    catch { }
}
// Streaming flag for components: asked once on mount, then every few seconds.
function useStreaming() {
    const [on, setOn] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
        let alive = true;
        const poll = () => isStreaming().then((v) => alive && setOn(!!v)).catch(() => { });
        poll();
        const timer = setInterval(poll, 3000);
        return () => { alive = false; clearInterval(timer); };
    }, []);
    return on;
}
async function disconnectAndSleep() {
    if (!(await disconnectStream()))
        return; // it says why; don't put the PC to sleep under a stream that is still up
    try {
        toast(describeSleep(await sleepHostVerified()));
    }
    catch (e) {
        toast(`Couldn't put the PC to sleep: ${e}`);
    }
}
function closeSideMenus() {
    try {
        DFL.Navigation?.CloseSideMenus?.();
    }
    catch { }
}

// ---- 1. In-game Steam menu --------------------------------------------------
// The menu's entries are built inside one Steam module and not exported, so there
// is no hook to add to the list. Its React component (the "navigation column") is
// found by what its source mentions, and wrapped at the one place every component
// passes through: React's jsx(). The wrapper renders the original unchanged and
// adds two copies of Steam's own "exit" entry above it.
const NAV_COLUMN_SIGNATURE = ["NavigationColumn", "CurrentGameLogo", "CurrentGameTitle", "flow-children"];
const hasNavColumnSignature = (src) => NAV_COLUMN_SIGNATURE.every((s) => src.includes(s));
// Does this Steam build still contain the menu component? Looks through Steam's
// webpack module sources once, so a changed Steam is reported at load, not guessed at.
function steamHasNavColumn() {
    let wreq = null;
    window.webpackChunksteamui.push([[Symbol("wake2play")], {}, (r) => { wreq = r; }]);
    return Object.values(wreq?.m ?? {}).some((f) => typeof f === "function" && hasNavColumnSignature(Function.prototype.toString.call(f)));
}
function withMenuItems(out) {
    const list = findKeyedList(out, "exit");
    if (!list) {
        warnOnce("exit", "the in-game menu has no 'exit' entry to put the items above — items not added");
        return out;
    }
    if (list.some((el) => el?.key === "w2p-disconnect"))
        return out;
    const at = list.findIndex((el) => el?.key === "exit");
    const exit = list[at];
    const item = (key, text, run) => SP_REACT.cloneElement(exit, {
        key, text, disabled: false, active: false,
        onActivate: () => { closeSideMenus(); void run(); },
        onSecondaryButton: undefined, onSecondaryActionDescription: undefined,
    });
    list.splice(at, 0, item("w2p-disconnect", "Disconnect (keep game running)", disconnectStream), item("w2p-disconnect-sleep", "Disconnect & sleep PC", disconnectAndSleep));
    return out;
}
// The array of menu entries (elements keyed by strKey) somewhere in the tree.
function findKeyedList(node, key, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8)
        return null;
    if (Array.isArray(node)) {
        if (node.some((el) => el?.key === key))
            return node;
        for (const child of node) {
            const found = findKeyedList(child, key, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    return findKeyedList(node.props?.children, key, depth + 1);
}
function installGameMenuPatch() {
    if (!steamHasNavColumn()) {
        warnOnce("navcolumn", "in-game menu component not found in this Steam build — no items added there");
        return () => { };
    }
    const state = { active: true };
    const isNav = new WeakMap(); // component function -> is it the menu column
    const wrappers = new WeakMap(); // menu column -> our wrapper
    const ours = new WeakSet();
    const wrapperFor = (orig) => {
        let w = wrappers.get(orig);
        if (!w) {
            w = function Wake2PlayNavColumn(props) {
                const out = orig(props); // Steam's menu, rendered as usual
                const streaming = useStreaming(); // hooks stay in the same order every render
                if (!state.active || !streaming)
                    return out;
                try {
                    return withMenuItems(out);
                }
                catch (e) {
                    warnOnce("inject", `adding menu items failed: ${e}`);
                    return out;
                }
            };
            wrappers.set(orig, w);
            ours.add(w);
        }
        return w;
    };
    const swap = (type) => {
        try {
            if (!state.active || typeof type !== "function" || ours.has(type))
                return type;
            let nav = isNav.get(type);
            if (nav === undefined)
                isNav.set(type, nav = hasNavColumnSignature(Function.prototype.toString.call(type)));
            return nav ? wrapperFor(type) : type;
        }
        catch {
            return type;
        }
    };
    const origJsx = SP_JSX.jsx, origJsxs = SP_JSX.jsxs;
    const jsx = (type, ...rest) => origJsx(swap(type), ...rest);
    const jsxs = (type, ...rest) => origJsxs(swap(type), ...rest);
    SP_JSX.jsx = jsx;
    SP_JSX.jsxs = jsxs;
    return () => {
        state.active = false; // inert even if something wrapped us after
        if (SP_JSX.jsx === jsx)
            SP_JSX.jsx = origJsx;
        if (SP_JSX.jsxs === jsxs)
            SP_JSX.jsxs = origJsxs;
    };
}

// ---- 2. Library game page ---------------------------------------------------
const onRemotePlayHost = (appid) => (window.appStore?.GetAppOverviewByAppID(appid)?.per_client_data ?? []).some((c) => c.clientid !== "0");
// A function, not a constant: plugin.js's helpers don't exist yet while this file loads.
const hostAction = (which) => which === "wake"
    ? { start: "Waking host…", busy: "Waking…", label: "Wake PC", run: wakeHost, describe: describeWake }
    : { start: "Putting host to sleep…", busy: "Sleeping…", label: "Sleep PC", run: sleepHostVerified, describe: describeSleep };
// The Play row's right-hand button group (Configure Controller, Manage), by the
// name of its CSS-module class: the hashed class changes between Steam builds.
const appButtonsClass = () => DFL.findModule((m) => m && typeof m === "object" && typeof m.AppButtons === "string" && typeof m.PlaySection === "string")?.AppButtons;
function HostButton({ appid }) {
    const anchor = SP_REACT.useRef(null);
    const [target, setTarget] = SP_REACT.useState(null); // the Play row's button container
    const [action, setAction] = SP_REACT.useState(null); // "wake" | "sleep" | null (hidden)
    const [busy, setBusy] = SP_REACT.useState(false);
    const refresh = async () => {
        try {
            if (!onRemotePlayHost(appid))
                return setAction(null);
            const { awake } = await hostStatus();
            setAction(awake === false ? "wake" : awake === true && !(await isStreaming()) ? "sleep" : null);
        }
        catch {
            setAction(null);
        }
    };
    SP_REACT.useEffect(() => {
        let alive = true;
        const look = () => {
            try {
                const cls = appButtonsClass();
                const found = cls ? anchor.current?.parentElement?.querySelector("." + cls) ?? null : null;
                if (alive)
                    setTarget((t) => (t === found || (t?.isConnected && !found) ? t : found));
            }
            catch {
                if (alive)
                    setTarget(null);
            }
        };
        look();
        const lookTimer = setInterval(look, 1000);
        void refresh();
        const refreshTimer = setInterval(() => { if (alive)
            void refresh(); }, 4000);
        return () => { alive = false; clearInterval(lookTimer); clearInterval(refreshTimer); };
    }, [appid]);
    const spec = action && hostAction(action);
    const click = async () => {
        setBusy(true);
        toast(spec.start);
        try {
            toast(spec.describe(await spec.run()));
        }
        catch (e) {
            toast(`${spec.label} failed: ${e}`);
        }
        finally {
            setBusy(false);
            void refresh();
        }
    };
    return SP_JSX.jsxs(SP_JSX.Fragment, { children: [
            SP_JSX.jsx("span", { ref: anchor, style: { display: "none" } }),
            spec && target && SP_REACTDOM.createPortal(SP_JSX.jsx(DFL.DialogButton, { disabled: busy, onClick: click,
                // sized like Steam's neighbouring round buttons (48px tall, 10px gap, 16px text)
                style: { width: "auto", minWidth: 0, height: "48px", flexShrink: 0, padding: "0 18px", margin: "0 0 0 10px", fontSize: "16px", whiteSpace: "nowrap" },
                children: busy ? spec.busy : spec.label }), target),
        ] });
}
function installLibraryPatch() {
    const route = "/library/app/:appid";
    if (!routerHook?.addPatch || !routerHook?.removePatch || !DFL.createReactTreePatcher) {
        warnOnce("routerhook", "routerHook patching unavailable — no button on game pages");
        return () => { };
    }
    const state = { active: true };
    const applied = [];
    const patch = routerHook.addPatch(route, (tree) => {
        try {
            const routeProps = DFL.findInReactTree(tree, (x) => x?.renderFunc);
            if (!routeProps) {
                warnOnce("route", "game page route has no renderFunc — no button on game pages");
                return tree;
            }
            const handler = DFL.createReactTreePatcher([
                (t) => DFL.findInReactTree(t, (x) => x?.props?.children?.props?.overview)?.props?.children,
            ], (_, ret) => {
                if (!state.active)
                    return ret;
                try {
                    addHostButton(ret);
                }
                catch (e) {
                    warnOnce("page", `adding the game page button failed: ${e}`);
                }
                return ret;
            });
            applied.push(DFL.afterPatch(routeProps, "renderFunc", handler));
        }
        catch (e) {
            warnOnce("route", `patching the game page failed: ${e}`);
        }
        return tree;
    });
    return () => {
        state.active = false;
        applied.forEach((p) => { try {
            p?.unpatch?.();
        }
        catch { } });
        try {
            routerHook.removePatch(route, patch);
        }
        catch { }
    };
}
// The page is an InnerContainer holding [hero, overview panel, ...]; the Play row
// is rendered inside the overview panel, so the button's anchor goes in there and
// the button itself is portalled into the Play row's button group.
function addHostButton(ret) {
    const classes = DFL.appDetailsClasses;
    const hasClass = (x, cls) => cls && typeof x?.props?.className === "string" && x.props.className.includes(cls);
    const inner = DFL.findInReactTree(ret, (x) => Array.isArray(x?.props?.children) && hasClass(x, classes?.InnerContainer));
    if (!inner)
        return; // loading screen
    const panel = inner.props.children.find((x) => hasClass(x, classes.AppDetailsOverviewPanel));
    const appid = panel && DFL.findInReactTree(panel.props.children, (x) => typeof x?.props?.overview?.appid === "number")?.props.overview.appid;
    if (typeof appid !== "number") {
        warnOnce("panel", "game page overview panel not found — no button on game pages");
        return;
    }
    const children = [].concat(panel.props.children ?? []);
    if (children.some((c) => c?.key === "w2p-host-button"))
        return;
    panel.props.children = [...children, SP_JSX.jsx(HostButton, { appid }, "w2p-host-button")];
}

// ---- switching both on/off --------------------------------------------------
let removeMenuPatches = () => { };
function setMenuPatches(enabled) {
    removeMenuPatches();
    removeMenuPatches = () => { };
    if (!enabled)
        return;
    const undo = [];
    for (const install of [installGameMenuPatch, installLibraryPatch]) {
        try {
            undo.push(install());
        }
        catch (e) {
            warnOnce(install.name, `${install.name} failed: ${e}`);
        }
    }
    removeMenuPatches = () => undo.forEach((u) => { try {
        u();
    }
    catch { } });
}
