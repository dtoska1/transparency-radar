// data.jsx — mock dataset for Radari Vendor admin
// Deterministic generation so the dataset is stable across reloads.

const MUNIS = ["Tirana", "Shkodër", "Durrës", "Vlorë", "Pogradec"];
const VERTICALS = ["Vendime", "Konsultime", "Prokurime"];

// muted hue per vertical (matches CSS vars)
const V_COLOR = {
  Vendime: "var(--v-vendime)",
  Konsultime: "var(--v-konsultime)",
  Prokurime: "var(--v-prokurime)",
};

const TITLES = {
  Vendime: [
    "Vendim Nr. {n} për miratimin e buxhetit vendor 2026",
    "Vendim për caktimin e tarifave të taksave vendore",
    "Vendim mbi dhënien e ndihmës ekonomike — periudha Maj 2026",
    "Vendim Nr. {n} për planin vjetor të investimeve publike",
    "Vendim për miratimin e strukturës organike të bashkisë",
    "Vendim mbi rregulloren e menaxhimit të mbetjeve urbane",
    "Vendim për dhënien në përdorim të sipërfaqes publike",
    "Vendim Nr. {n} për ngritjen e komisionit të vlerësimit",
    "Vendim për nivelin e tarifës së pastrimit dhe gjelbërimit",
  ],
  Konsultime: [
    "Konsultim publik për Planin e Përgjithshëm Vendor 2026–2030",
    "Konsultim mbi rregulloren e parkimit në zonën qendrore",
    "Dëgjesë publike për programin buxhetor afatmesëm",
    "Konsultim për strategjinë e zhvillimit të turizmit bregdetar",
    "Takim dëgjimor mbi planin e gjelbërimit urban",
    "Konsultim publik për tarifat e shërbimit të ujësjellësit",
    "Konsultim mbi planin vendor për mbetjet e ngurta",
    "Dëgjesë publike: rikonstruksioni i sheshit qendror",
  ],
  Prokurime: [
    "Njoftim kontrate: furnizim me pajisje për shkollat 9-vjeçare",
    "Procedurë e hapur: mirëmbajtja vjetore e ndriçimit publik",
    "Tender: rikonstruksion i çerdhes Nr. {n}",
    "Njoftim fituesi: pastrimi i hapësirave publike 2026",
    "Procedurë: blerje automjete për shërbimet komunale",
    "Tender: asfaltim i rrugëve dytësore — Loti {n}",
    "Njoftim kontrate: shërbime mirëmbajtjeje të infrastrukturës IT",
    "Procedurë e hapur: ndërtim i parkut të lojërave për fëmijë",
  ],
};

const OFFICIAL_SRC = {
  Tirana: "Bashkia Tiranë — Portali Zyrtar",
  "Shkodër": "Bashkia Shkodër — Faqja Zyrtare",
  "Durrës": "Bashkia Durrës — Portali Zyrtar",
  "Vlorë": "Bashkia Vlorë — Faqja Zyrtare",
  Pogradec: "Bashkia Pogradec — Portali Zyrtar",
};
const PROXY_SRC = [
  "Open Data Albania (proxy)",
  "AIS — Open Spending (proxy)",
  "Open Procurement Albania (proxy)",
];

// ---- deterministic PRNG ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260601);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const HEX = "0123456789abcdef";
function sha256(seed) {
  const r = mulberry32(seed * 2654435761);
  let s = "";
  for (let i = 0; i < 64; i++) s += HEX[Math.floor(r() * 16)];
  return s;
}
function pad(n, w) { return String(n).padStart(w, "0"); }
function dstr(daysAgo) {
  const d = new Date(2026, 5, 4); // Jun 4 2026
  d.setDate(d.getDate() - daysAgo);
  return d;
}
function fmtDate(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function relTime(d) {
  const mins = Math.round((new Date(2026, 5, 4, 9, 12) - d) / 60000);
  if (mins < 60) return mins + "m ago";
  const h = Math.round(mins / 60);
  if (h < 24) return h + "h ago";
  const dd = Math.round(h / 24);
  return dd + "d ago";
}

const MUNI_SLUG = { Tirana: "tr", "Shkodër": "sh", "Durrës": "dr", "Vlorë": "vl", Pogradec: "pg" };
const VERT_SLUG = { Vendime: "vend", Konsultime: "kons", Prokurime: "prok" };

function makeDocs() {
  const docs = [];
  const N = 34;
  let nDecree = 40;
  for (let i = 0; i < N; i++) {
    const muni = pick(MUNIS);
    const vertical = pick(VERTICALS);
    const isOfficial = rnd() > 0.34;
    // status weighting: mostly pending, some approved/rejected
    const sroll = rnd();
    const status = i < 4 ? "pending" : sroll < 0.55 ? "pending" : sroll < 0.85 ? "approved" : "rejected";
    // tamper stamping: official almost always; proxy ~55%
    const stamped = isOfficial ? rnd() > 0.06 : rnd() > 0.45;
    const daysAgo = Math.floor(rnd() * 26) + 1;
    const pub = dstr(daysAgo);
    nDecree += Math.floor(rnd() * 6) + 1;
    const title = pick(TITLES[vertical]).replace("{n}", nDecree);
    const id = "DOC-" + pad(2600 + i, 4);
    const srcId = `${MUNI_SLUG[muni]}-${VERT_SLUG[vertical]}-2026-${pad(nDecree, 3)}`;
    const hash = stamped ? sha256(i + 7) : null;

    // version history — ~30% have 2-3 versions
    const vRoll = rnd();
    const nVers = vRoll < 0.18 ? 3 : vRoll < 0.4 ? 2 : 1;
    const versions = [];
    for (let v = 0; v < nVers; v++) {
      const vAgo = daysAgo + (nVers - 1 - v) * (2 + Math.floor(rnd() * 4));
      versions.push({
        ver: "v" + (v + 1),
        date: dstr(vAgo),
        hash: stamped ? sha256(i * 31 + v + 3) : sha256(i * 13 + v + 99),
        note: v === 0
          ? "Initial capture from source"
          : v === nVers - 1
            ? "Annex / attachment updated by publisher"
            : "Metadata corrected (title, reference no.)",
        sizeKb: 120 + Math.floor(rnd() * 900),
      });
    }
    if (stamped && versions.length) versions[versions.length - 1].hash = hash;

    docs.push({
      id, title, muni, vertical, status,
      published: pub,
      publishedStr: fmtDate(pub),
      ingested: dstr(daysAgo - (rnd() > 0.5 ? 0 : -1) + Math.floor(rnd() * 2)),
      source: {
        type: isOfficial ? "official" : "proxy",
        name: isOfficial ? OFFICIAL_SRC[muni] : pick(PROXY_SRC),
      },
      stamped,
      hash,
      vColor: V_COLOR[vertical],
      provenance: {
        sourceId: srcId,
        origin: isOfficial ? "official_portal" : "proxy_aggregator",
        pageUrl: isOfficial
          ? `https://${MUNI_SLUG[muni]}.gov.al/vendimet/${pad(nDecree, 3)}`
          : `https://opendata.al/dataset/${MUNI_SLUG[muni]}/${VERT_SLUG[vertical]}/${pad(nDecree, 3)}`,
        sourceUrl: isOfficial
          ? `https://${MUNI_SLUG[muni]}.gov.al/files/${srcId}.pdf`
          : `https://opendata.al/files/${srcId}.pdf`,
      },
      timestamp: stamped
        ? { status: rnd() > 0.04 ? "valid" : "unverifiable", tsa: pick(["FreeTSA RFC-3161", "DigiCert TSA", "Sectigo TSA"]), at: dstr(daysAgo) }
        : null,
      pages: 2 + Math.floor(rnd() * 22),
      sizeKb: 120 + Math.floor(rnd() * 1400),
      versions,
    });
  }
  return docs;
}

// ---- scrape runs ----
function makeScrapeRuns() {
  const runs = [];
  const sources = [
    { name: "Bashkia Tiranë — Portali Zyrtar", muni: "Tirana", type: "official" },
    { name: "Bashkia Shkodër — Faqja Zyrtare", muni: "Shkodër", type: "official" },
    { name: "Bashkia Durrës — Portali Zyrtar", muni: "Durrës", type: "official" },
    { name: "Bashkia Vlorë — Faqja Zyrtare", muni: "Vlorë", type: "official" },
    { name: "Bashkia Pogradec — Portali Zyrtar", muni: "Pogradec", type: "official" },
    { name: "Open Data Albania", muni: "All", type: "proxy" },
    { name: "Open Procurement Albania", muni: "All", type: "proxy" },
  ];
  let id = 880;
  for (let s = 0; s < sources.length; s++) {
    const src = sources[s];
    const runsPer = 3;
    for (let r = 0; r < runsPer; r++) {
      const minsAgo = r * (180 + Math.floor(rnd() * 240)) + Math.floor(rnd() * 90) + s * 12;
      const when = new Date(2026, 5, 4, 9, 12);
      when.setMinutes(when.getMinutes() - minsAgo);
      const seen = 14 + Math.floor(rnd() * 60);
      const errored = r === 0 ? (s === 2 || s === 6 ? rnd() > 0.4 : rnd() > 0.86) : rnd() > 0.9;
      runs.push({
        id: "RUN-" + (id++),
        source: src.name,
        muni: src.muni,
        type: src.type,
        at: when,
        status: errored ? "error" : "success",
        seen: errored ? Math.floor(seen * rnd() * 0.5) : seen,
        added: errored ? 0 : Math.floor(rnd() * 9),
        durationMs: 800 + Math.floor(rnd() * 9000),
        error: errored ? pick(["TLS handshake timeout", "HTTP 503 from origin", "Selector drift: list container not found", "Robots.txt fetch blocked"]) : null,
        isLatest: r === 0,
      });
    }
  }
  runs.sort((a, b) => b.at - a.at);
  return runs;
}

const DOCS = makeDocs();
const RUNS = makeScrapeRuns();

// ---- aggregates ----
function aggregates(docs) {
  const byVertical = {}; VERTICALS.forEach((v) => (byVertical[v] = 0));
  const byMuni = {}; MUNIS.forEach((m) => (byMuni[m] = { pending: 0, approved: 0, rejected: 0 }));
  let pending = 0, approved = 0, rejected = 0, stamped = 0;
  docs.forEach((d) => {
    byVertical[d.vertical]++;
    byMuni[d.muni][d.status]++;
    if (d.status === "pending") pending++;
    else if (d.status === "approved") approved++;
    else rejected++;
    if (d.stamped) stamped++;
  });
  return { byVertical, byMuni, pending, approved, rejected, stamped, total: docs.length };
}

window.DB = {
  MUNIS, VERTICALS, V_COLOR,
  DOCS, RUNS,
  aggregates,
  fmtDate, fmtDateTime, relTime,
};
