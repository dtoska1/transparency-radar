// app.jsx — root, state, routing, tweaks
const { useState: useStateApp, useEffect: useEffectApp, useCallback: useCallbackApp, useRef: useRefApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "accent": "#0f766e",
  "density": 4,
  "showHash": true,
  "tamperFilter": "all",
  "bulkFlow": "both"
}/*EDITMODE-END*/;

const ACCENTS = ["#0f766e", "#2563eb", "#4338ca", "#1e293b", "#b91c1c"];

function App() {
  const {
    useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakRadio, TweakSlider, TweakColor,
    Sidebar, Topbar, ToastHost, Dashboard, ReviewQueue, DocumentDetail,
  } = window;
  const DB = window.DB;

  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useStateApp("dashboard");
  const [detailId, setDetailId] = useStateApp(null);
  const [docs, setDocs] = useStateApp(() => DB.DOCS);
  const [toasts, setToasts] = useStateApp([]);
  const toastId = useRefApp(0);

  // density → CSS vars
  const dens = t.density; // 1..5
  const rowH = [44, 40, 37, 33, 29][dens - 1];
  const rowFs = [14, 13.5, 13, 12.5, 12][dens - 1];
  const cellPy = [11, 9, 7, 5.5, 4][dens - 1];

  const pushToast = useCallbackApp((msg, kind = "ok") => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, msg, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2600);
  }, []);

  const setStatus = (ids, status) => {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    setDocs((ds) => ds.map((d) => (set.has(d.id) ? { ...d, status } : d)));
  };
  const onApprove = (id) => setStatus(id, "approved");
  const onReject = (id) => setStatus(id, "rejected");
  const onBulkApprove = (ids) => setStatus(ids, "approved");

  const openDoc = (id) => { setDetailId(id); setView("detail"); };
  const pending = docs.filter((d) => d.status === "pending").length;
  const detailDoc = docs.find((d) => d.id === detailId);

  const crumbs = view === "dashboard" ? ["Radari Vendor", "Overview"]
    : view === "queue" ? ["Radari Vendor", "Review Queue"]
      : ["Radari Vendor", "Review Queue", detailDoc ? detailDoc.id : "Document"];

  return (
    <div className="app" data-theme={t.dark ? "dark" : "light"}
      style={{
        "--accent": t.accent,
        "--accent-press": "color-mix(in srgb, " + t.accent + " 82%, black)",
        "--row-h": rowH + "px", "--row-fs": rowFs + "px", "--cell-py": cellPy + "px",
      }}>
      <Sidebar view={view === "detail" ? "queue" : view} setView={(v) => { setView(v); }} pendingCount={pending} />
      <div className="main">
        <Topbar crumbs={crumbs} />
        <div className="scroll" key={view + (detailId || "")}>
          {view === "dashboard" && <Dashboard docs={docs} runs={DB.RUNS} setView={setView} openDoc={openDoc} />}
          {view === "queue" && (
            <ReviewQueue
              docs={docs} onApprove={onApprove} onReject={onReject} onBulkApprove={onBulkApprove}
              openDoc={openDoc} tw={t} pushToast={pushToast} />
          )}
          {view === "detail" && (
            <DocumentDetail doc={detailDoc} onApprove={onApprove} onReject={onReject}
              back={() => setView("queue")} pushToast={pushToast} />
          )}
        </div>
      </div>

      <ToastHost toasts={toasts} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakColor label="Accent" value={t.accent} options={ACCENTS} onChange={(v) => setTweak("accent", v)} />
        <TweakSlider label="Table density" value={t.density} min={1} max={5} step={1}
          onChange={(v) => setTweak("density", v)} />

        <TweakSection label="Review queue" />
        <TweakToggle label="Show hash column" value={t.showHash} onChange={(v) => setTweak("showHash", v)} />
        <TweakRadio label="Tamper-evidence" value={t.tamperFilter}
          options={[{ value: "all", label: "All" }, { value: "stamped", label: "Stamped" }, { value: "unstamped", label: "Unstamped" }]}
          onChange={(v) => setTweak("tamperFilter", v)} />

        <TweakSection label="Bulk approve flow" />
        <TweakRadio label="Variation" value={t.bulkFlow}
          options={[{ value: "inline", label: "Inline" }, { value: "confirm", label: "Confirm" }, { value: "both", label: "Both" }]}
          onChange={(v) => setTweak("bulkFlow", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
