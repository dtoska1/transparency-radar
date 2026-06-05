// components.jsx — shared primitives
const { useState, useRef, useEffect, useCallback } = React;

// ---------- Icons (simple geometric strokes) ----------
const ICON = {
  dashboard: "M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z",
  queue: "M3 5h18M3 12h18M3 19h12",
  check: "M4 12l5 5L20 6",
  x: "M6 6l12 12M18 6L6 18",
  chevDown: "M5 8l5 5 5-5",
  chevRight: "M9 5l5 5-5 5",
  chevLeft: "M14 5l-5 5 5 5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  shield: "M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  external: "M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
  copy: "M9 9h10v12H9zM5 15V3h10v3",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  fingerprint: "M12 3a9 9 0 0 0-9 9M21 12a9 9 0 0 0-4-7.5M7 20a7 7 0 0 1-1-9M12 7a5 5 0 0 1 5 5v1M12 12v4M9 21a9 9 0 0 0 1-12",
  filter: "M3 5h18l-7 8v6l-4-2v-4z",
  refresh: "M20 11a8 8 0 1 0-2 5M20 5v6h-6",
  alert: "M12 3l9 16H3zM12 10v4M12 17.5v.5",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  building: "M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V11h-4M9 7h2M9 11h2M9 15h2",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  inbox: "M3 12h5l2 3h4l2-3h5M5 5h14l2 7v7H3v-7z",
  link: "M10 14a4 4 0 0 0 5.5 0l3-3a4 4 0 0 0-5.5-5.5l-1 1M14 10a4 4 0 0 0-5.5 0l-3 3A4 4 0 0 0 11 18.5l1-1",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18",
  history: "M12 8v4l3 2M3.5 9A9 9 0 1 1 3 13M3 4v5h5",
  hash: "M9 3L7 21M17 3l-2 18M4 8h16M3 16h16",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
};
function Icon({ name, size, style, fill }) {
  const s = size || 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={style}
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON[name]} fill={fill || "none"} stroke={fill ? "none" : "currentColor"} />
    </svg>
  );
}

// ---------- Badges ----------
function StatusBadge({ status }) {
  const map = {
    pending: ["warn", "Pending"],
    approved: ["ok", "Approved"],
    rejected: ["err", "Rejected"],
  };
  const [cls, label] = map[status] || ["neutral", status];
  return (
    <span className={"badge " + cls}>
      <span className="dot" style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}

function VerticalTag({ vertical }) {
  return (
    <span className="vtag">
      <span className="vb" style={{ background: window.DB.V_COLOR[vertical] }} />
      {vertical}
    </span>
  );
}

function SourceBadge({ source }) {
  if (source.type === "official") {
    return (
      <span className="src official" title={source.name}>
        <span className="ic"><Icon name="building" size={14} /></span>
        Official
      </span>
    );
  }
  return (
    <span className="src proxy" title={source.name}>
      <span className="ic"><Icon name="link" size={14} /></span>
      Proxy
    </span>
  );
}

// SHA-256 + RFC-3161 tamper-evidence cell
function TamperCell({ doc, showHash }) {
  if (!doc.stamped) {
    return (
      <span className="tamper no" title="No tamper-evidence record — needs stamping">
        <span className="vchk"><Icon name="x" size={11} /></span>
        {showHash ? <span className="h">unstamped</span> : null}
      </span>
    );
  }
  return (
    <span className="tamper" title={`SHA-256 + RFC-3161 timestamp\n${doc.hash}`}>
      <span className="vchk"><Icon name="check" size={11} /></span>
      {showHash ? <span className="h">{doc.hash.slice(0, 10)}…</span> : null}
    </span>
  );
}

// ---------- Multi-select filter dropdown ----------
function FilterSelect({ label, options, selected, onChange, counts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (o) => {
    if (selected.includes(o)) onChange(selected.filter((x) => x !== o));
    else onChange([...selected, o]);
  };
  const summary = selected.length === 0 ? "All" : selected.length === 1 ? selected[0] : selected.length + " selected";
  return (
    <div className="sel-wrap" ref={ref}>
      <button className="selbox" onClick={() => setOpen((v) => !v)}>
        <span className="lbl">{label}:</span>
        <span>{summary}</span>
        <Icon name="chevDown" size={13} />
      </button>
      {open && (
        <div className="menu">
          {options.map((o) => (
            <div key={o} className={"menu-i" + (selected.includes(o) ? " on" : "")} onClick={() => toggle(o)}>
              <span className="ck-mini">{selected.includes(o) && <Icon name="check" size={9} />}</span>
              {o}
              {counts && <span className="tail">{counts[o] ?? 0}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Sidebar ----------
function Sidebar({ view, setView, pendingCount }) {
  const Item = ({ id, icon, label, count }) => (
    <button className={"nav-i" + (view === id ? " on" : "")} onClick={() => setView(id)}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {count != null && <span className="cnt">{count}</span>}
    </button>
  );
  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-mark">
          <Icon name="shield" size={17} fill="#fff" />
        </div>
        <div>
          <div className="sb-name">Radari Vendor</div>
          <div className="sb-sub">Transparency Radar · AL</div>
        </div>
      </div>
      <nav className="sb-nav">
        <div className="sb-sect">Operations</div>
        <Item id="dashboard" icon="dashboard" label="Overview" />
        <Item id="queue" icon="inbox" label="Review Queue" count={pendingCount} />
        <div className="sb-sect">Reference</div>
        <button className="nav-i" onClick={() => setView("queue")}><Icon name="check" size={16} /><span>Approved</span></button>
        <button className="nav-i" onClick={() => setView("dashboard")}><Icon name="globe" size={16} /><span>Sources</span></button>
      </nav>
      <div className="sb-foot">
        <div className="avatar">AK</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.1 }}>Arben Krasniqi</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>Reviewer · Tiranë</div>
        </div>
      </div>
    </aside>
  );
}

// ---------- Topbar ----------
function Topbar({ crumbs }) {
  return (
    <div className="topbar">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep"><Icon name="chevRight" size={12} /></span>}
            {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="tb-spacer" />
      <div className="tb-search">
        <Icon name="search" size={14} />
        <input placeholder="Search documents, hash, source ID…" />
      </div>
      <span className="tb-env">staging</span>
    </div>
  );
}

// ---------- Toast host ----------
function ToastHost({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + (t.kind || "ok")}>
          <span className="ic"><Icon name={t.kind === "err" ? "x" : "check"} size={11} /></span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  Icon, StatusBadge, VerticalTag, SourceBadge, TamperCell,
  FilterSelect, Sidebar, Topbar, ToastHost,
});
