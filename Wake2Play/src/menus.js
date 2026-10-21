// ---- Buttons in Steam's own menus (hand-maintained; no build step) ----------
// deploy.sh concatenates decky-runtime.js + menus.js + plugin.js into one module,
// so this file uses plugin.js's helpers (disconnectStream, wakeHost, toast, ...) by
// name; they are only touched when a patch runs, long after everything has loaded.
//
// Two patches, both opt-out through the "Show buttons in Steam's menus" setting:
//   1. In-game Steam menu: two items above "Exit game", only while streaming.
//   2. Library game page: a Wake PC / Sleep PC icon button in the hero's top-right.
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
// DISABLED 2026-10-21: wrapping SP_JSX.jsx fights Decky's injectFCTrampoline (it stubs and
// restores that same function around every trampolined render) and was followed by Decky's
// own panel failing to render and another plugin failing to load. Off until there is a
// mechanism that doesn't touch SP_JSX.jsx. The game-page button (routerHook) is unaffected.
const GAME_MENU_PATCH_ENABLED = false;
function installGameMenuPatch() {
    if (!GAME_MENU_PATCH_ENABLED)
        return () => { };
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
    logEvent("menus: in-game menu hook installed");
    // Diagnostic: on 2026-10-21 the hook was found gone mid-session with no reload
    // logged; say when it happens instead of guessing.
    // Something occasionally puts Steam's original back (seen twice on 2026-10-21, within
    // 10 s of a plugin load; culprit unknown). Re-install over the original only — if
    // another plugin wrapped it instead, leave theirs alone.
    // The culprit is Decky's own injectFCTrampoline: around each trampolined render it
    // stubs SP_JSX.jsx and then restores the copy it saved at startup — constantly, even
    // idle. Re-check every second (one comparison) so the gap stays short; log hourly.
    let reinstalls = 0, loggedAt = 0;
    const watch = setInterval(() => {
        if (!state.active || SP_JSX.jsx === jsx)
            return;
        if (SP_JSX.jsx === origJsx) {
            SP_JSX.jsx = jsx;
            if (SP_JSX.jsxs === origJsxs)
                SP_JSX.jsxs = jsxs;
            reinstalls++;
            if (Date.now() - loggedAt > 3600000) {
                loggedAt = Date.now();
                logEvent(`menus: in-game menu hook re-installed after Decky reset it (${reinstalls} so far)`);
            }
        }
        else
            warnOnce("replaced", `in-game menu hook replaced by something else (${String(SP_JSX.jsx).slice(0, 60)}) — left alone`);
    }, 1000);
    return () => {
        clearInterval(watch);
        logEvent("menus: in-game menu hook removed");
        state.active = false; // inert even if something wrapped us after
        if (SP_JSX.jsx === jsx)
            SP_JSX.jsx = origJsx;
        if (SP_JSX.jsxs === jsxs)
            SP_JSX.jsxs = origJsxs;
    };
}

// ---- 2. Library game page ---------------------------------------------------
// Placed and made focusable the way MoonDeck does its moon button, so it is
// D-pad reachable the same way: an anchor row (zero height) between the hero banner
// and the overview panel, holding an absolutely positioned Focusable > Button that
// uses Steam's own MenuButton class. Where MoonDeck's button is on the page (looked
// for in the page at render time, not by plugin name) ours sits just left of it, same
// height and look; without it ours takes the same spot.
// Online, Steam attaches the host to every owned game; only "installed" ones can stream.
const onHostNow = (overview) => (overview?.per_client_data ?? []).some((c) => c.clientid !== "0" && c.installed === true);
// Steam lists a game's Remote Play host only while that host is online, so an asleep PC
// would hide "Wake PC" exactly when it's needed. Remember, while the PC is up, which
// games it has (whole library scan, kept on the Deck), and trust that list when it's down.
const HOST_APPS_KEY = "wake2play.hostApps";
let hostApps = null;
function rememberedHostApps() {
    if (!hostApps) {
        try {
            hostApps = new Set(JSON.parse(localStorage.getItem(HOST_APPS_KEY) ?? "[]"));
        }
        catch {
            hostApps = new Set();
        }
    }
    return hostApps;
}
const HOST_APPS_TIME_KEY = "wake2play.hostAppsAt";
// Returns how many games the host lists right now (0 = host not listed: kept old list).
function rememberHostApps() {
    try {
        const all = window.collectionStore?.allAppsCollection?.allApps ?? [];
        const onHost = all.filter(onHostNow).map((o) => Number(o.appid));
        if (!onHost.length)
            return 0; // host not listed right now: keep what we knew
        hostApps = new Set(onHost);
        localStorage.setItem(HOST_APPS_KEY, JSON.stringify(onHost));
        localStorage.setItem(HOST_APPS_TIME_KEY, String(Date.now()));
        return onHost.length;
    }
    catch (e) {
        warnOnce("hostapps", `could not remember the host's games: ${e}`);
        return 0;
    }
}
const hostAppsInfo = () => ({ count: rememberedHostApps().size, at: Number(localStorage.getItem(HOST_APPS_TIME_KEY)) || null });
// Steam lists the host's games a few seconds after the host comes online: retry for
// up to a minute. Resolves to the number learned (0 if the host never showed up).
let learning = null;
function learnHostApps() {
    learning ??= (async () => {
        try {
            for (let i = 0; i < 20; i++) {
                const n = rememberHostApps();
                if (n)
                    return n;
                await delay(3000);
            }
            return 0;
        }
        finally {
            learning = null;
        }
    })();
    return learning;
}
const onRemotePlayHost = (appid) => onHostNow(window.appStore?.GetAppOverviewByAppID(Number(appid))) || rememberedHostApps().has(Number(appid));
// A function, not a constant: plugin.js's helpers don't exist yet while this file loads.
const hostAction = (which) => which === "wake"
    ? { start: "Waking host…", label: "Wake PC", run: wakeHost, describe: describeWake }
    : { start: "Putting host to sleep…", label: "Sleep PC", run: sleepHostVerified, describe: describeSleep };
// Power symbol (Wake); FaBed from the bundled icon set is Sleep.
const PowerIcon = (props) => SP_JSX.jsxs("svg", { viewBox: "0 0 24 24", width: props.size, height: props.size, fill: "none", stroke: "currentColor", strokeWidth: "2.6", strokeLinecap: "round", children: [
        SP_JSX.jsx("path", { d: "M12 3v9" }), SP_JSX.jsx("path", { d: "M6.3 6.9a8 8 0 1 0 11.4 0" }),
    ] });
const MOONDECK_CONTAINER = ".moondeck-container";
const HOST_BUTTON_GAP_PX = 10;
// Like MoonDeck's: no side margin from the MenuButton class. Selected, Steam paints the
// button white; its own buttons' icons turn dark then, ours must too or they vanish.
const HOST_BUTTON_CSS = ".w2p-button { margin: 0 !important; }"
    + " .w2p-button.gpfocus, .w2p-button:focus, .w2p-button:hover { color: #0e141b !important; }"
    + " .w2p-button.gpfocus svg:not([fill=none]), .w2p-button:focus svg:not([fill=none]), .w2p-button:hover svg:not([fill=none]) { fill: currentColor !important; }"
    + " .w2p-button.gpfocus svg[stroke], .w2p-button:focus svg[stroke], .w2p-button:hover svg[stroke] { stroke: currentColor !important; }"
    + " .w2p-button svg[fill=none] { fill: none !important; }"; // outline icons (power) stay outlines
function HostButton({ appid }) {
    const anchor = SP_REACT.useRef(null);
    const [action, setAction] = SP_REACT.useState(null); // "wake" | "sleep" | null (hidden)
    const [busy, setBusy] = SP_REACT.useState(false);
    const [place, setPlace] = SP_REACT.useState({ right: "2.8vw", bottom: "16px", moondeck: false });
    const [hidden, setHidden] = SP_REACT.useState(false); // hero shown full screen
    const refresh = async () => {
        try {
            if (!onRemotePlayHost(appid))
                return setAction(null);
            const { awake } = await hostStatus();
            if (awake === true)
                rememberHostApps();
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
                const row = anchor.current, page = row?.parentElement;
                if (!row || !page)
                    return;
                // MoonDeck's button, if it is on the page: sit left of it, level with it
                const md = page.querySelector(MOONDECK_CONTAINER);
                const rowBox = row.getBoundingClientRect(), mdBox = md?.getBoundingClientRect();
                const next = mdBox && mdBox.width > 0
                    ? { right: `${Math.round(rowBox.right - mdBox.left + HOST_BUTTON_GAP_PX)}px`, bottom: `${Math.round(rowBox.bottom - mdBox.bottom)}px`, moondeck: true }
                    : { right: "2.8vw", bottom: "16px", moondeck: false };
                // Like MoonDeck's, hide while the hero is shown full screen
                const top = [...(page.querySelector("." + DFL.appDetailsClasses.Header)?.children ?? [])].find((c) => c.className.includes(DFL.appDetailsHeaderClasses.TopCapsule));
                const fs = top ? ["FullscreenEnterStart", "FullscreenEnterActive", "FullscreenEnterDone", "FullscreenExitStart", "FullscreenExitActive"].some((k) => DFL.appDetailsHeaderClasses[k] && top.className.includes(DFL.appDetailsHeaderClasses[k])) : false;
                if (alive) {
                    setPlace((p) => (p.right === next.right && p.bottom === next.bottom && p.moondeck === next.moondeck ? p : next));
                    setHidden(fs);
                }
            }
            catch { }
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
    const Icon = action === "wake" ? PowerIcon : FaBed;
    return SP_JSX.jsx("div", { ref: anchor, id: "wake2play", style: { position: "relative", height: 0 }, children: spec && !hidden &&
            SP_JSX.jsxs(DFL.Focusable, { className: DFL.joinClassNames(DFL.basicAppDetailsSectionStylerClasses.AppButtons, "w2p-container"), style: { position: "absolute", right: place.right, bottom: place.bottom }, children: [
                    SP_JSX.jsx("style", { children: HOST_BUTTON_CSS }),
                    SP_JSX.jsx(DFL.Focusable, { children: SP_JSX.jsx(DFL.Button, { disabled: busy, "aria-label": spec.label, title: spec.label, onClick: click,
                            // MoonDeck's own class, only when its button is there, so a
                            // theme it applies (Clean / High contrast) applies to ours too
                            className: DFL.joinClassNames(DFL.playSectionClasses.MenuButton, "w2p-button", place.moondeck ? "moondeck-button" : ""),
                            children: SP_JSX.jsx(Icon, { size: 28 }) }) }),
                ] }) });
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
// The page is an InnerContainer holding [hero, overview panel, ...]; the anchor goes
// between the hero and the panel, where MoonDeck puts its own.
function addHostButton(ret) {
    const classes = DFL.appDetailsClasses;
    const hasClass = (x, cls) => cls && typeof x?.props?.className === "string" && x.props.className.includes(cls);
    const inner = DFL.findInReactTree(ret, (x) => Array.isArray(x?.props?.children) && hasClass(x, classes?.InnerContainer));
    if (!inner)
        return; // loading screen
    const at = inner.props.children.findIndex((x) => hasClass(x, classes.AppDetailsOverviewPanel));
    const panel = inner.props.children[at];
    const appid = panel && DFL.findInReactTree(panel.props.children, (x) => typeof x?.props?.overview?.appid === "number")?.props.overview.appid;
    if (typeof appid !== "number") {
        warnOnce("panel", "game page overview panel not found — no button on game pages");
        return;
    }
    if (inner.props.children.some((c) => c?.key === "w2p-host-button"))
        return;
    inner.props.children.splice(at, 0, SP_JSX.jsx(HostButton, { appid }, "w2p-host-button"));
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
