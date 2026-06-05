// ReviewQueue.jsx — primary review screen
const { useState: useStateRQ, useMemo: useMemoRQ, useRef: useRefRQ, useEffect: useEffectRQ } = React;

function HeaderCheck({ checked, indeterminate, onChange }) {
  const ref = useRefRQ(null);
  useEffectRQ(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="ck" checked={checked} onChange={onChange} />;
}

// ---- Confirm drawer ----
function ConfirmDrawer({ docs, onClose, onConfirm }) {
  const { Icon } = window;
  const DB = window.DB;
  const [exMuni, setExMuni] = useStateRQ(new Set());
  const [exVert, setExVert] = useStateRQ(new Set());

  const groups = useMemoRQ(() => {
    const g = {};
    docs.forEach((d) => {
      if (!g[d.muni]) g[d.muni] = {};
      if (!g[d.muni][d.vertical]) g[d.muni][d.vertical] = [];
      g[d.muni][d.vertical].push(d);
    });
    return g;
  }, [docs]);

  const effective = docs.filter((d) => !exMuni.has(d.muni) && !exVert.has(d.muni + "|" + d.vertical));
  const stampedN = effective.filter((d) => d.stamped).length;
  const unstamped = effective.length - stampedN;

  const toggleMuni = (m) => { const s = new Set(exMuni); s.has(m) ? s.delete(m) : s.add(m); setExMuni(s); };
  const toggleVert = (m, v) => { const k = m + "|" + v; const s = new Set(exVert); s.has(k) ? s.delete(k) : s.add(k); setExVert(s); };

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-hd">
          <h2><Icon name="check" size={18} style={{ color: "var(--ok)" }} />Confirm bulk approval</h2>
          <p>Review the scope before publishing. Approved documents become publicly visible immediately. Uncheck a municipality or vertical to narrow the batch.</p>
        </div>
        <div className="drawer-bd">
          {Object.keys(groups).sort().map((m) => {
            const verts = groups[m];
            const muniCount = Object.values(verts).flat().length;
            const muniOff = exMuni.has(m);
            return (
              <div className="scope-grp" key={m}>
                <div className="scope-grp-hd" onClick={() => toggleMuni(m)}>
                  <input type="checkbox" className="ck" checked={!muniOff} readOnly />
                  <span className="mu">{m}</span>
                  <span className="ct">{muniCount} doc{muniCount !== 1 ? "s" : ""}</span>
                </div>
                {Object.keys(verts).sort().map((v) => {
                  const list = verts[v];
                  const off = muniOff || exVert.has(m + "|" + v);
                  return (
                    <div className={"scope-sub" + (off ? " off" : "")} key={v}
                      onClick={() => !muniOff && toggleVert(m, v)}>
                      <input type="checkbox" className="ck" checked={!off} readOnly disabled={muniOff} />
                      <span className="vb" style={{ width: 7, height: 7, borderRadius: 2, background: DB.V_COLOR[v], display: "inline-block" }} />
                      {v}
                      <span className="ct">{list.length}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {unstamped > 0 && (
            <div className="badge warn" style={{ height: "auto", padding: "8px 10px", width: "100%", justifyContent: "flex-start", gap: 8, lineHeight: 1.4, alignItems: "flex-start" }}>
              <Icon name="alert" size={14} style={{ marginTop: 1, flex: "0 0 auto" }} />
              <span>{unstamped} document{unstamped !== 1 ? "s" : ""} in this batch {unstamped !== 1 ? "are" : "is"} <b>unstamped</b> (no SHA-256 / RFC-3161 record). They can still be approved, but will be flagged on the public record.</span>
            </div>
          )}
        </div>
        <div className="drawer-ft">
          <div style={{ fontSize: 13 }}>
            <b className="tnum" style={{ fontSize: 15 }}>{effective.length}</b> <span style={{ color: "var(--text-2)" }}>will be approved</span>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>{stampedN} stamped · {unstamped} unstamped</div>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn ok" disabled={effective.length === 0} onClick={() => onConfirm(effective.map((d) => d.id))}>
            <Icon name="check" size={15} />Approve {effective.length}
          </button>
        </div>
      </div>
    </>
  );
}

function ReviewQueue({ docs, onApprove, onReject, onBulkApprove, openDoc, tw, pushToast }) {
  const { Icon, StatusBadge, VerticalTag, SourceBadge, TamperCell, FilterSelect } = window;
  const DB = window.DB;

  const [fMuni, setFMuni] = useStateRQ([]);
  const [fVert, setFVert] = useStateRQ([]);
  const [fStatus, setFStatus] = useStateRQ(["pending"]);
  const [q, setQ] = useStateRQ("");
  const [sel, setSel] = useStateRQ(() => new Set());
  const [drawer, setDrawer] = useStateRQ(null); // array of docs to confirm

  // counts for filter menus (over status-relevant set)
  const muniCounts = useMemoRQ(() => { const c = {}; DB.MUNIS.forEach((m) => c[m] = 0); docs.forEach((d) => { if (d.status === "pending") c[d.muni]++; }); return c; }, [docs]);
  const vertCounts = useMemoRQ(() => { const c = {}; DB.VERTICALS.forEach((v) => c[v] = 0); docs.forEach((d) => { if (d.status === "pending") c[d.vertical]++; }); return c; }, [docs]);

  const filtered = useMemoRQ(() => {
    return docs.filter((d) => {
      if (fMuni.length && !fMuni.includes(d.muni)) return false;
      if (fVert.length && !fVert.includes(d.vertical)) return false;
      if (fStatus.length && !fStatus.includes(d.status)) return false;
      if (tw.tamperFilter === "stamped" && !d.stamped) return false;
      if (tw.tamperFilter === "unstamped" && d.stamped) return false;
      if (q) {
        const s = q.toLowerCase();
        if (!d.title.toLowerCase().includes(s) && !d.id.toLowerCase().includes(s) &&
          !(d.hash && d.hash.includes(s)) && !d.provenance.sourceId.includes(s)) return false;
      }
      return true;
    });
  }, [docs, fMuni, fVert, fStatus, q, tw.tamperFilter]);

  const pendingTotal = useMemoRQ(() => docs.filter((d) => d.status === "pending").length, [docs]);

  // keep selection within the currently filtered + pending set
  const selectablePending = filtered.filter((d) => d.status === "pending");
  const selIds = [...sel].filter((id) => selectablePending.some((d) => d.id === id));
  const allSel = selectablePending.length > 0 && selIds.length === selectablePending.length;
  const someSel = selIds.length > 0 && !allSel;

  const toggleAll = () => {
    if (allSel) setSel(new Set());
    else setSel(new Set(selectablePending.map((d) => d.id)));
  };
  const toggleOne = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };

  const selDocs = selectablePending.filter((d) => selIds.includes(d.id));
  const selMunis = [...new Set(selDocs.map((d) => d.muni))];
  const selVerts = [...new Set(selDocs.map((d) => d.vertical))];

  const doApprove = (ids) => { onBulkApprove(ids); setSel(new Set()); setDrawer(null); pushToast(`${ids.length} document${ids.length !== 1 ? "s" : ""} approved & published`); };

  const triggerBulk = () => {
    if (tw.bulkFlow === "inline") doApprove(selIds);
    else setDrawer(selDocs);
  };
  // scope-by-filter entry (confirm flow): approve all filtered pending via drawer
  const scopeApprove = () => setDrawer(selectablePending);

  const hasActiveFilters = fMuni.length || fVert.length || (fStatus.length === 1 && fStatus[0] !== "pending") || fStatus.length > 1 || q || tw.tamperFilter !== "all";

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div className="page page-wide">
        <div className="page-hd">
          <div>
            <h1>Review Queue</h1>
            <p><b className="tnum" style={{ color: "var(--warn)" }}>{pendingTotal}</b> documents awaiting approval · showing <b className="tnum">{filtered.length}</b></p>
          </div>
          <div className="right">
            {tw.bulkFlow === "confirm" && (
              <button className="btn primary" disabled={selectablePending.length === 0} onClick={scopeApprove}>
                <Icon name="check" size={15} />Bulk approve by scope…
              </button>
            )}
          </div>
        </div>

        {/* filter bar */}
        <div className="filterbar">
          <span className="fb-count"><Icon name="filter" size={14} style={{ verticalAlign: -2, color: "var(--text-3)" }} /> Filter</span>
          <FilterSelect label="Municipality" options={DB.MUNIS} selected={fMuni} onChange={setFMuni} counts={muniCounts} />
          <FilterSelect label="Vertical" options={DB.VERTICALS} selected={fVert} onChange={setFVert} counts={vertCounts} />
          <FilterSelect label="Status" options={["pending", "approved", "rejected"]} selected={fStatus} onChange={setFStatus} />
          {tw.tamperFilter !== "all" && (
            <span className="chip on">{tw.tamperFilter === "stamped" ? "Stamped only" : "Unstamped only"}<span className="x" title="Set in Tweaks"><Icon name="shield" size={11} /></span></span>
          )}
          <div style={{ flex: 1 }} />
          {hasActiveFilters && (
            <button className="chip" onClick={() => { setFMuni([]); setFVert([]); setFStatus(["pending"]); setQ(""); }}>
              Clear<span className="x"><Icon name="x" size={11} /></span>
            </button>
          )}
        </div>

        {/* table */}
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="c-check"><HeaderCheck checked={allSel} indeterminate={someSel} onChange={toggleAll} /></th>
                  <th>Document</th>
                  <th>Municipality</th>
                  <th>Vertical</th>
                  <th>Published</th>
                  <th>Source</th>
                  <th>Tamper-evidence</th>
                  <th>Status</th>
                  <th className="c-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const isSel = selIds.includes(d.id);
                  const canSel = d.status === "pending";
                  return (
                    <tr key={d.id} className={isSel ? "sel" : ""}>
                      <td className="c-check">
                        {canSel
                          ? <input type="checkbox" className="ck" checked={isSel} onChange={() => toggleOne(d.id)} />
                          : <span style={{ display: "inline-block", width: 16 }} />}
                      </td>
                      <td>
                        <span className="doc-title" onClick={() => openDoc(d.id)}>{d.title}</span>
                        <div className="doc-id mono">{d.id} · {d.pages}p</div>
                      </td>
                      <td><span style={{ fontWeight: 500 }}>{d.muni}</span></td>
                      <td><VerticalTag vertical={d.vertical} /></td>
                      <td className="num mono">{d.publishedStr}</td>
                      <td><SourceBadge source={d.source} /></td>
                      <td><TamperCell doc={d} showHash={tw.showHash} /></td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="c-actions">
                        {d.status === "pending" ? (
                          <span className="row-actions">
                            <button className="btn sm ok" onClick={() => { onApprove(d.id); pushToast("Approved · " + d.id); }}><Icon name="check" size={13} />Approve</button>
                            <button className="btn sm danger" onClick={() => { onReject(d.id); pushToast("Rejected · " + d.id, "err"); }}><Icon name="x" size={13} />Reject</button>
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-3)", fontSize: 12, paddingRight: 4 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="empty">
              <div className="ic"><Icon name="inbox" size={22} /></div>
              <h4>Nothing in this view</h4>
              <p>No documents match the current filters. Try clearing them.</p>
            </div>
          )}
        </div>
      </div>

      {/* inline bulk action bar */}
      {selIds.length > 0 && tw.bulkFlow !== "confirm" && (
        <div className="bulkbar">
          <span className="n"><span className="pill tnum">{selIds.length}</span> selected</span>
          <div className="div" />
          <div className="scope">
            <span style={{ opacity: .7 }}>scope</span>
            {selMunis.slice(0, 3).map((m) => <span className="sc-chip" key={m}>{m}</span>)}
            {selMunis.length > 3 && <span className="sc-chip">+{selMunis.length - 3}</span>}
            <span style={{ opacity: .4 }}>·</span>
            {selVerts.map((v) => <span className="sc-chip" key={v}>{v}</span>)}
          </div>
          <div className="div" />
          <button className="b gh" onClick={() => setSel(new Set())}>Clear</button>
          <button className="b go" onClick={triggerBulk}>
            <Icon name="check" size={14} />
            {tw.bulkFlow === "inline" ? `Approve ${selIds.length}` : `Review & approve ${selIds.length}…`}
          </button>
        </div>
      )}

      {drawer && <ConfirmDrawer docs={drawer} onClose={() => setDrawer(null)} onConfirm={doApprove} />}
    </div>
  );
}

window.ReviewQueue = ReviewQueue;
