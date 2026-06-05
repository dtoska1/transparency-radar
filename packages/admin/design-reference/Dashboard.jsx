// Dashboard.jsx — overview / health
const { useMemo: useMemoD } = React;

function Dashboard({ docs, runs, setView, openDoc }) {
  const { Icon, StatusBadge, fmtCount } = window;
  const DB = window.DB;
  const agg = DB.aggregates(docs);

  // latest run per source
  const latestPerSource = useMemoD(() => {
    const m = {};
    runs.forEach((r) => { if (!m[r.source]) m[r.source] = r; });
    return Object.values(m).sort((a, b) => b.at - a.at);
  }, [runs]);
  const healthy = latestPerSource.filter((r) => r.status === "success").length;

  const maxMuni = Math.max(...DB.MUNIS.map((m) => {
    const b = agg.byMuni[m]; return b.pending + b.approved + b.rejected;
  }));

  const recent = runs.slice(0, 8);

  const vIcon = { Vendime: "doc", Konsultime: "globe", Prokurime: "layers" };

  return (
    <div className="page">
      <div className="page-hd">
        <div>
          <h1>Overview</h1>
          <p>Ingestion health and review backlog across {DB.MUNIS.length} municipalities · {DB.VERTICALS.join(" / ")}</p>
        </div>
        <div className="right">
          <button className="btn"><Icon name="refresh" size={15} />Run all scrapers</button>
          <button className="btn primary" onClick={() => setView("queue")}><Icon name="inbox" size={15} />Review queue</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="top"><span className="ik"><Icon name="doc" size={14} /></span>Total documents</div>
          <div className="big tnum">{agg.total}</div>
          <div className="sub"><span className="delta up"><Icon name="arrowUp" size={11} style={{ verticalAlign: "-1px" }} /> 6</span> ingested in last 24h</div>
        </div>
        <div className="kpi">
          <div className="top"><span className="ik" style={{ color: "var(--warn)" }}><Icon name="inbox" size={14} /></span>Pending review</div>
          <div className="big tnum" style={{ color: "var(--warn)" }}>{agg.pending}</div>
          <div className="sub">across {DB.MUNIS.length} municipalities</div>
        </div>
        <div className="kpi">
          <div className="top"><span className="ik" style={{ color: "var(--ok)" }}><Icon name="check" size={14} /></span>Approved</div>
          <div className="big tnum" style={{ color: "var(--ok)" }}>{agg.approved}</div>
          <div className="sub">publicly visible</div>
        </div>
        <div className="kpi">
          <div className="top"><span className="ik" style={{ color: "var(--accent)" }}><Icon name="shield" size={14} /></span>Tamper-stamped</div>
          <div className="big tnum">{Math.round((agg.stamped / agg.total) * 100)}<span style={{ fontSize: 16, color: "var(--text-3)" }}>%</span></div>
          <div className="sub">{agg.stamped}/{agg.total} have SHA-256 + RFC-3161</div>
        </div>
      </div>

      {/* row: vertical totals + scrape health */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", marginBottom: 16 }}>
        <div className="card">
          <div className="card-hd"><h3>Documents by vertical</h3><div className="right" style={{ fontSize: 11.5, color: "var(--text-3)" }}>all statuses</div></div>
          <div className="vbig">
            {DB.VERTICALS.map((v) => (
              <div className="seg" key={v}>
                <div className="lab"><span className="vb" style={{ width: 8, height: 8, borderRadius: 2, background: DB.V_COLOR[v], display: "inline-block" }} />{v}</div>
                <div className="n tnum">{agg.byVertical[v]}</div>
                <div className="meta">{Math.round((agg.byVertical[v] / agg.total) * 100)}% of corpus</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h3>Scrape health</h3>
            <div className="right"><span className={"badge " + (healthy === latestPerSource.length ? "ok" : "warn")}>{healthy}/{latestPerSource.length} healthy</span></div>
          </div>
          <div className="card-bd" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {latestPerSource.map((r) => (
              <div className="srcrow" key={r.source}>
                <span className="sdot" style={{ background: r.status === "success" ? "var(--ok)" : "var(--err)" }} />
                <div className="nm">{r.source.replace(/ —.*/, "").replace("Bashkia ", "")}
                  <span className="mu"> · {r.muni === "All" ? "proxy" : r.muni}</span>
                </div>
                <div className="meta">
                  {r.status === "success" ? `${r.seen} seen · +${r.added}` : <span style={{ color: "var(--err)" }}>error</span>}
                  <div className="t">{DB.relTime(r.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* per-municipality pending vs approved */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-hd">
          <h3>Pending vs approved by municipality</h3>
          <div className="right">
            <div className="legend">
              <span><i style={{ background: "var(--warn)" }} />Pending</span>
              <span><i style={{ background: "var(--ok)" }} />Approved</span>
              <span><i style={{ background: "var(--err)" }} />Rejected</span>
            </div>
          </div>
        </div>
        <div className="card-bd" style={{ paddingTop: 6, paddingBottom: 8 }}>
          {DB.MUNIS.map((m) => {
            const b = agg.byMuni[m];
            const total = b.pending + b.approved + b.rejected;
            const w = (n) => (total ? (n / maxMuni) * 100 : 0);
            return (
              <div className="barrow" key={m}>
                <div className="mu">{m}</div>
                <div className="track">
                  <i style={{ width: w(b.pending) + "%", background: "var(--warn)" }} />
                  <i style={{ width: w(b.approved) + "%", background: "var(--ok)" }} />
                  <i style={{ width: w(b.rejected) + "%", background: "var(--err)" }} />
                </div>
                <div className="nums">{b.pending} · {b.approved} · {b.rejected}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* recent scrape runs */}
      <div className="tbl-wrap">
        <div className="card-hd" style={{ borderRadius: 0 }}>
          <h3>Recent scrape runs</h3>
          <div className="right" style={{ fontSize: 12, color: "var(--text-2)" }}>last {recent.length} of {runs.length}</div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th><th>Source</th><th>Municipality</th><th>Started</th>
                <th>Status</th><th style={{ textAlign: "right" }}>Items seen</th>
                <th style={{ textAlign: "right" }}>New</th><th style={{ textAlign: "right" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ color: "var(--text-3)" }}>{r.id}</td>
                  <td style={{ fontWeight: 500 }}>{r.source.replace(/ —.*/, "")}</td>
                  <td style={{ color: "var(--text-2)" }}>{r.muni === "All" ? "—" : r.muni}</td>
                  <td className="mono" style={{ color: "var(--text-2)" }}>{DB.fmtDateTime(r.at)}</td>
                  <td>
                    {r.status === "success"
                      ? <span className="badge ok"><span className="dot" style={{ background: "currentColor" }} />Success</span>
                      : <span className="badge err" title={r.error}><span className="dot" style={{ background: "currentColor" }} />Error</span>}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>{r.seen}</td>
                  <td className="num" style={{ textAlign: "right", color: r.added ? "var(--ok)" : "var(--text-3)" }}>{r.added ? "+" + r.added : "—"}</td>
                  <td className="num" style={{ textAlign: "right" }}>{(r.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
