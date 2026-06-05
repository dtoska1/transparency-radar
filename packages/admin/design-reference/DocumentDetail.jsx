// DocumentDetail.jsx — single document view
const { useState: useStateDD } = React;

function CopyBtn({ text, pushToast }) {
  const { Icon } = window;
  return (
    <button className="iconbtn" title="Copy" style={{ width: 22, height: 22 }}
      onClick={() => { try { navigator.clipboard.writeText(text); } catch (e) {} pushToast("Copied to clipboard"); }}>
      <Icon name="copy" size={13} />
    </button>
  );
}

function DocumentDetail({ doc, onApprove, onReject, back, pushToast }) {
  const { Icon, StatusBadge, VerticalTag, SourceBadge } = window;
  const DB = window.DB;
  if (!doc) return null;

  const versions = [...doc.versions].reverse(); // newest first
  const changed = doc.versions.length > 1;

  return (
    <div className="page">
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={back}><Icon name="chevLeft" size={14} />Queue</button>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{doc.id}</span>
      </div>

      <div className="page-hd" style={{ marginBottom: 18, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, flexWrap: "wrap" }}>
            <VerticalTag vertical={doc.vertical} />
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{doc.muni}</span>
            <StatusBadge status={doc.status} />
            {changed && <span className="badge info"><Icon name="history" size={11} /> {doc.versions.length} versions</span>}
          </div>
          <h1 style={{ fontSize: 21, lineHeight: 1.25, maxWidth: 760, textWrap: "pretty" }}>{doc.title}</h1>
        </div>
        <div className="right" style={{ paddingTop: 4 }}>
          {doc.status === "pending" ? (
            <>
              <button className="btn danger" onClick={() => { onReject(doc.id); pushToast("Rejected · " + doc.id, "err"); back(); }}><Icon name="x" size={15} />Reject</button>
              <button className="btn ok" onClick={() => { onApprove(doc.id); pushToast("Approved & published · " + doc.id); back(); }}><Icon name="check" size={15} />Approve & publish</button>
            </>
          ) : (
            <StatusBadge status={doc.status} />
          )}
        </div>
      </div>

      <div className="dd-grid">
        {/* LEFT: preview + version history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* document preview placeholder */}
          <div className="card">
            <div className="card-hd">
              <h3>Document</h3>
              <div className="right">
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{doc.pages} pages · {(doc.sizeKb / 1024).toFixed(1)} MB · PDF</span>
                <a className="btn sm" href={doc.provenance.sourceUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} />Open source</a>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{
                height: 260, borderRadius: 8, border: "1px solid var(--border)",
                background: "repeating-linear-gradient(135deg, var(--surface-2) 0 12px, var(--surface) 12px 24px)",
                display: "grid", placeItems: "center", color: "var(--text-3)", textAlign: "center",
              }}>
                <div>
                  <Icon name="doc" size={26} style={{ opacity: .5 }} />
                  <div className="mono" style={{ fontSize: 11.5, marginTop: 8 }}>[ rendered PDF preview ]</div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>{doc.provenance.sourceId}.pdf</div>
                </div>
              </div>
            </div>
          </div>

          {/* version history */}
          <div className="card">
            <div className="card-hd">
              <h3><Icon name="history" size={15} style={{ verticalAlign: -3, marginRight: 6, color: "var(--text-2)" }} />Version history</h3>
              <div className="right"><span className="badge neutral">append-only</span></div>
            </div>
            <div className="card-bd">
              <div className="vh">
                {versions.map((v, i) => {
                  const isCur = i === 0;
                  const prev = versions[i + 1];
                  const hashChanged = prev && prev.hash !== v.hash;
                  return (
                    <div className={"vh-i" + (isCur ? " cur" : "")} key={v.ver}>
                      <span className="node" />
                      <div className="vh-head">
                        <span className="ver">{v.ver}</span>
                        {isCur && <span className="badge ok" style={{ height: 18 }}>current</span>}
                        <span className="when">{DB.fmtDateTime(v.date)} · {v.sizeKb} KB</span>
                      </div>
                      <div className="vh-note">{v.note}</div>
                      <div className="vh-hash">
                        <Icon name="hash" size={11} style={{ flex: "0 0 auto", opacity: .6 }} />
                        <span>{v.hash}</span>
                        {hashChanged && <span className="tagchg">content changed</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: tamper-evidence + provenance + metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* tamper evidence */}
          <div className="card">
            <div className="card-hd"><h3><Icon name="shield" size={15} style={{ verticalAlign: -3, marginRight: 6, color: "var(--accent)" }} />Tamper-evidence</h3></div>
            <div className="card-bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {doc.stamped ? (
                <>
                  <div className="hashbox">
                    <div className="ic"><Icon name="fingerprint" size={16} /></div>
                    <div className="body">
                      <div className="lab">SHA-256 digest</div>
                      <div className="val">{doc.hash}</div>
                    </div>
                    <CopyBtn text={doc.hash} pushToast={pushToast} />
                  </div>
                  <div className={"ts" + (doc.timestamp.status !== "valid" ? " invalid" : "")}>
                    <div className="ic"><Icon name={doc.timestamp.status === "valid" ? "check" : "alert"} size={15} /></div>
                    <div className="body">
                      <div className="t1">{doc.timestamp.status === "valid" ? "RFC-3161 timestamp valid" : "Timestamp unverifiable"}</div>
                      <div className="t2">{doc.timestamp.tsa} · {DB.fmtDateTime(doc.timestamp.at)}</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="ts invalid">
                  <div className="ic"><Icon name="alert" size={15} /></div>
                  <div className="body">
                    <div className="t1">Not stamped</div>
                    <div className="t2" style={{ fontFamily: "var(--sans)", color: "var(--text-2)" }}>No SHA-256 / RFC-3161 record. Captured from a proxy source without a verifiable timestamp.</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* provenance — 4 fields */}
          <div className="card">
            <div className="card-hd"><h3>Provenance</h3><div className="right"><span className="badge neutral">4 fields</span></div></div>
            <div className="card-bd">
              <div className="prov">
                <div className="cell">
                  <div className="k"><Icon name="hash" size={11} />Source ID</div>
                  <div className="v">{doc.provenance.sourceId}</div>
                </div>
                <div className="cell">
                  <div className="k"><Icon name="globe" size={11} />Origin</div>
                  <div className="v">{doc.provenance.origin}</div>
                </div>
                <div className="cell">
                  <div className="k"><Icon name="link" size={11} />Page URL</div>
                  <div className="v"><a href={doc.provenance.pageUrl} target="_blank" rel="noreferrer">{doc.provenance.pageUrl.replace("https://", "")}</a></div>
                </div>
                <div className="cell">
                  <div className="k"><Icon name="doc" size={11} />Source URL</div>
                  <div className="v"><a href={doc.provenance.sourceUrl} target="_blank" rel="noreferrer">{doc.provenance.sourceUrl.replace("https://", "")}</a></div>
                </div>
              </div>
            </div>
          </div>

          {/* metadata */}
          <div className="card">
            <div className="card-hd"><h3>Metadata</h3></div>
            <div className="card-bd" style={{ paddingTop: 4, paddingBottom: 4 }}>
              <div className="meta-list">
                <div className="meta-row"><div className="k">Document ID</div><div className="v mono">{doc.id}</div></div>
                <div className="meta-row"><div className="k">Municipality</div><div className="v">{doc.muni}</div></div>
                <div className="meta-row"><div className="k">Vertical</div><div className="v"><VerticalTag vertical={doc.vertical} /></div></div>
                <div className="meta-row"><div className="k">Source</div><div className="v" style={{ display: "flex", alignItems: "center", gap: 8 }}><SourceBadge source={doc.source} /><span style={{ color: "var(--text-2)", fontSize: 12.5 }}>{doc.source.name}</span></div></div>
                <div className="meta-row"><div className="k">Published</div><div className="v mono">{DB.fmtDate(doc.published)}</div></div>
                <div className="meta-row"><div className="k">Ingested</div><div className="v mono">{DB.fmtDateTime(doc.ingested)}</div></div>
                <div className="meta-row"><div className="k">File</div><div className="v mono">{doc.pages} pages · {(doc.sizeKb / 1024).toFixed(1)} MB</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DocumentDetail = DocumentDetail;
