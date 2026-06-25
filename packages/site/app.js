'use strict';

const API_BASE = 'https://api.radarvendor.com';
const PAGE_SIZE = 20;

const VERTICALS = [
  { key: 'vendime', label: 'Vendime' },
  { key: 'prokurime', label: 'Prokurime' },
  { key: 'konsultime', label: 'Konsultime' },
];

const MUNICIPALITIES = [
  { slug: 'tirana', label: 'Tiranë' },
  { slug: 'shkoder', label: 'Shkodër' },
  { slug: 'durres', label: 'Durrës' },
  { slug: 'vlore', label: 'Vlorë' },
  { slug: 'pogradec', label: 'Pogradec' },
];

const MONTHS_AL = [
  'janar',
  'shkurt',
  'mars',
  'prill',
  'maj',
  'qershor',
  'korrik',
  'gusht',
  'shtator',
  'tetor',
  'nëntor',
  'dhjetor',
];

const municipalityLabel = (slug) => MUNICIPALITIES.find((m) => m.slug === slug)?.label ?? slug;

function formatDateDisplay(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${Number.parseInt(d, 10)} ${MONTHS_AL[Number.parseInt(m, 10) - 1]} ${y}`;
}

function formatTimestampDisplay(isoTimestamp) {
  const date = new Date(isoTimestamp);
  return date.toLocaleString('sq-AL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function rowTitle(row) {
  if (row.app_id) return row.title || row.procurement_object || row.app_id;
  return row.title;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '#';
  } catch {
    return '#';
  }
}

const state = {
  vertical: 'vendime',
  municipality: '',
  year: '',
  q: '',
  offset: 0,
};

const detailCache = new Map();
let requestSeq = 0;

const el = {
  tabs: document.getElementById('tabs'),
  chips: document.getElementById('municipality-chips'),
  yearSelect: document.getElementById('year-select'),
  searchInput: document.getElementById('search-input'),
  resultsMeta: document.getElementById('results-meta'),
  results: document.getElementById('results'),
  pagination: document.getElementById('pagination'),
};

function renderTabs() {
  el.tabs.innerHTML = '';
  for (const v of VERTICALS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab${v.key === state.vertical ? ' active' : ''}`;
    button.textContent = v.label;
    button.addEventListener('click', () => {
      if (state.vertical === v.key) return;
      state.vertical = v.key;
      state.offset = 0;
      renderTabs();
      loadResults();
    });
    el.tabs.appendChild(button);
  }
}

function renderChips() {
  el.chips.innerHTML = '';
  const all = { slug: '', label: 'Të gjitha' };
  for (const m of [all, ...MUNICIPALITIES]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${m.slug === state.municipality ? ' active' : ''}`;
    button.textContent = m.label;
    button.addEventListener('click', () => {
      if (state.municipality === m.slug) return;
      state.municipality = m.slug;
      state.offset = 0;
      renderChips();
      loadResults();
    });
    el.chips.appendChild(button);
  }
}

function renderYearOptions() {
  const currentYear = new Date().getFullYear();
  el.yearSelect.innerHTML = '<option value="">Të gjitha vitet</option>';
  for (let year = currentYear; year >= 2023; year--) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    el.yearSelect.appendChild(option);
  }
}

function buildListUrl() {
  const url = new URL(`/api/${state.vertical}`, API_BASE);
  if (state.municipality) url.searchParams.set('municipality', state.municipality);
  if (state.year) url.searchParams.set('year', state.year);
  if (state.q) url.searchParams.set('q', state.q);
  url.searchParams.set('limit', String(PAGE_SIZE + 1));
  url.searchParams.set('offset', String(state.offset));
  return url.toString();
}

function renderLoading() {
  el.resultsMeta.textContent = 'Po ngarkohet…';
  el.results.innerHTML = '<div class="state-line">Po ngarkohet…</div>';
  el.pagination.innerHTML = '';
}

function renderError(onRetry) {
  el.resultsMeta.textContent = '';
  el.results.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'state-line error';
  wrap.textContent = 'Dokumentet nuk u ngarkuan. ';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'link-button';
  retry.textContent = 'Provo përsëri';
  retry.addEventListener('click', onRetry);
  wrap.appendChild(retry);
  el.results.appendChild(wrap);
  el.pagination.innerHTML = '';
}

function renderEmpty() {
  el.results.innerHTML = '<div class="state-line">Asnjë dokument nuk u gjet me këto filtra.</div>';
}

async function loadResults() {
  const seq = ++requestSeq;
  renderLoading();

  let response;
  try {
    response = await fetch(buildListUrl());
  } catch {
    if (seq === requestSeq) renderError(loadResults);
    return;
  }
  if (seq !== requestSeq) return;

  if (!response.ok) {
    renderError(loadResults);
    return;
  }

  const body = await response.json();
  const rows = body.data ?? [];
  const hasNext = rows.length > PAGE_SIZE;
  const pageRows = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  renderResultsMeta(pageRows.length, hasNext);
  renderResults(pageRows);
  renderPagination(hasNext);
}

function renderResultsMeta(count, hasNext) {
  if (count === 0) {
    el.resultsMeta.textContent = '';
    return;
  }
  const from = state.offset + 1;
  const to = state.offset + count;
  el.resultsMeta.textContent = hasNext
    ? `Po shfaqen dokumentet ${from}–${to}`
    : `Po shfaqen dokumentet ${from}–${to} (faqja e fundit)`;
}

function renderResults(rows) {
  el.results.innerHTML = '';
  if (rows.length === 0) {
    renderEmpty();
    return;
  }

  for (const row of rows) {
    el.results.appendChild(renderRow(row));
  }
}

function renderRow(row) {
  const article = document.createElement('article');
  article.className = 'doc-row';

  const head = document.createElement('div');
  head.className = 'doc-head';
  const tag = document.createElement('span');
  tag.className = 'doc-tag';
  tag.textContent = `${municipalityLabel(row.municipality).toUpperCase()} · ${formatDateDisplay(row.published_date)}`;
  head.appendChild(tag);
  article.appendChild(head);

  const title = document.createElement('h3');
  title.className = 'doc-title';
  title.textContent = rowTitle(row);
  article.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'doc-actions';

  const viewLink = document.createElement('a');
  viewLink.className = 'btn-primary';
  viewLink.href = safeHttpUrl(row.source_url);
  viewLink.target = '_blank';
  viewLink.rel = 'noopener noreferrer';
  viewLink.textContent = 'Shiko dokumentin';
  actions.appendChild(viewLink);

  const techToggle = document.createElement('button');
  techToggle.type = 'button';
  techToggle.className = 'link-button';
  techToggle.textContent = 'Detaje teknike';
  actions.appendChild(techToggle);

  article.appendChild(actions);

  const techPanel = document.createElement('div');
  techPanel.className = 'tech-panel hidden';
  article.appendChild(techPanel);

  let loaded = false;
  techToggle.addEventListener('click', async () => {
    const opening = techPanel.classList.contains('hidden');
    techPanel.classList.toggle('hidden');
    techToggle.textContent = opening ? 'Fshih detajet' : 'Detaje teknike';
    if (opening && !loaded) {
      loaded = true;
      await loadTechDetails(row, techPanel, viewLink);
    }
  });

  return article;
}

async function loadTechDetails(row, panel, viewLink) {
  panel.innerHTML = '<div class="state-line">Po ngarkohet…</div>';

  const cacheKey = `${state.vertical}:${row.id}`;
  let detail = detailCache.get(cacheKey);
  if (!detail) {
    try {
      const response = await fetch(new URL(`/api/${state.vertical}/${row.id}`, API_BASE));
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = await response.json();
      detail = body.data;
      detailCache.set(cacheKey, detail);
    } catch {
      panel.innerHTML =
        '<div class="state-line error">Detajet teknike nuk u ngarkuan. <button type="button" class="link-button" data-retry>Provo përsëri</button></div>';
      panel.querySelector('[data-retry]').addEventListener('click', () => {
        detailCache.delete(cacheKey);
        loadTechDetails(row, panel, viewLink);
      });
      return;
    }
  }

  renderTechPanel(detail, panel, viewLink);
}

function renderTechPanel(detail, panel, viewLink) {
  panel.innerHTML = '';
  const docs = detail.documents ?? [];

  if (docs.length === 0) {
    panel.innerHTML = '<div class="state-line">Pa dokument të lidhur ende.</div>';
    return;
  }

  if (docs[0]?.slot_ref) {
    viewLink.href = safeHttpUrl(docs[0].slot_ref);
  }

  for (const doc of docs) {
    panel.appendChild(renderDocBlock(doc));
  }
}

function renderDocBlock(doc) {
  const block = document.createElement('div');
  block.className = 'tech-block';

  const hashLabel = document.createElement('div');
  hashLabel.className = 'tech-label';
  hashLabel.textContent = 'Gjurma SHA-256';
  block.appendChild(hashLabel);

  const hashValue = document.createElement('div');
  hashValue.className = 'hash-value';
  hashValue.textContent = doc.sha256;
  block.appendChild(hashValue);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'link-button';
  copyButton.textContent = 'Kopjo';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(doc.sha256);
      copyButton.textContent = 'Kopjuar ✓';
      setTimeout(() => {
        copyButton.textContent = 'Kopjo';
      }, 1700);
    } catch {
      // Clipboard API unavailable — hash is already shown in full above.
    }
  });
  block.appendChild(copyButton);

  const stampLabel = document.createElement('div');
  stampLabel.className = 'tech-label stamp-label';
  stampLabel.textContent = 'Vulë kohore · RFC 3161';
  block.appendChild(stampLabel);

  const stampStatus = document.createElement('div');
  if (doc.tsr_timestamp_at) {
    stampStatus.className = 'stamp-status stamped';
    stampStatus.textContent = `✓ I vulosur më ${formatTimestampDisplay(doc.tsr_timestamp_at)}`;
  } else {
    stampStatus.className = 'stamp-status pending';
    stampStatus.textContent = 'Akoma pa u vulosur me kohë';
  }
  block.appendChild(stampStatus);

  return block;
}

function renderPagination(hasNext) {
  el.pagination.innerHTML = '';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'page-button';
  prev.textContent = '‹ Më parë';
  prev.disabled = state.offset === 0;
  prev.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    loadResults();
  });
  el.pagination.appendChild(prev);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'page-button';
  next.textContent = 'Më pas ›';
  next.disabled = !hasNext;
  next.addEventListener('click', () => {
    state.offset += PAGE_SIZE;
    loadResults();
  });
  el.pagination.appendChild(next);
}

function init() {
  renderTabs();
  renderChips();
  renderYearOptions();

  el.yearSelect.addEventListener('change', (event) => {
    state.year = event.target.value;
    state.offset = 0;
    loadResults();
  });

  let searchTimer;
  el.searchInput.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = event.target.value.trim();
      state.offset = 0;
      loadResults();
    }, 350);
  });

  loadResults();
}

init();
