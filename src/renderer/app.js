'use strict';
/* global ICONS */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = '') => `<span class="ico ${cls}">${ICONS[name] || ''}</span>`;

const STATUS = {
  error: { label: 'Error', color: 'var(--error)', icon: 'error' },
  warning: { label: 'Warning', color: 'var(--warning)', icon: 'warning' },
  unknown: { label: 'No cause found', color: 'var(--unknown)', icon: 'unknown' },
  loaded: { label: 'Loaded', color: 'var(--loaded)', icon: 'loaded' },
  ok: { label: 'OK', color: 'var(--ok)', icon: 'ok' },
  info: { label: 'Info', color: 'var(--info)', icon: 'info' },
};
const ENV_ICON = { config: 'file', runtime: 'coffee', jython: 'python', pymodules: 'folder', javalibs: 'folder', jruby: 'ruby', checkerJava: 'code', jythonRun: 'code' };
const TYPE_ICON = { java: 'java', python: 'python', ruby: 'ruby' };

const state = { info: null, result: null, filter: 'problems', query: '', selected: null, scanning: false };

// ------------------------------------------------------------ helpers
function fillIcons(root = document) {
  for (const el of $$('[data-ico]', root)) el.innerHTML = ICONS[el.dataset.ico] || '';
}

function toast(text, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.setProperty('--c', STATUS[kind] ? STATUS[kind].color : 'var(--ok)');
  t.innerHTML = ico(STATUS[kind] ? STATUS[kind].icon : 'ok') + '<span>' + esc(text) + '</span>';
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 2600);
}

function status(text, right) {
  $('#statusText').textContent = text;
  if (right !== undefined) $('#statusRight').textContent = right;
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ------------------------------------------------------------ scanning
async function scan() {
  if (state.scanning) return;
  state.scanning = true;
  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.classList.add('spin');
  $('.lbl', btn).textContent = 'Scanning…';
  $('#progress').classList.remove('hidden');
  $('#progressBar').style.width = '3%';
  $('#scanStatus').classList.remove('idle');
  $('#scanMsg').textContent = 'Reading Burp user settings…';
  status('Scanning…');
  try {
    const r = await window.bec.scan();
    if (r.busy) return;
    if (r.error) {
      showWelcome('The scan failed: ' + r.error.split('\n')[0]);
      toast('Scan failed', 'error');
      status('Scan failed');
      return;
    }
    state.result = r.result;
    render();
    const s = r.result.summary;
    status(
      r.result.environment.find(e => e.id === 'config' && e.status === 'error')
        ? 'Burp settings not found'
        : `Scanned ${plural(s.total, 'extension')} in ${(r.result.durationMs / 1000).toFixed(1)} s`,
      `${s.loaded} loaded · ${s.notLoaded} not loaded · ${s.errors} with errors`,
    );
  } finally {
    state.scanning = false;
    btn.disabled = false;
    btn.classList.remove('spin');
    $('.lbl', btn).textContent = 'Scan';
    $('#progressBar').style.width = '100%';
    setTimeout(() => { $('#progress').classList.add('hidden'); $('#progressBar').style.width = '0'; }, 350);
  }
}

window.bec.onProgress(({ pct, message }) => {
  $('#progressBar').style.width = Math.max(3, pct) + '%';
  $('#scanMsg').textContent = message + '…';
  status(message + '…');
});

function showWelcome(message) {
  $('#welcome').classList.remove('hidden');
  $('#results').classList.add('hidden');
  if (message) {
    $('#scanStatus').classList.add('idle');
    $('#scanMsg').textContent = message;
  }
}

// ------------------------------------------------------------ rendering
function render() {
  const r = state.result;
  if (!r) return;
  const cfgBad = r.environment.find(e => e.id === 'config' && e.status === 'error');

  // config chip
  const chip = $('#configChipText');
  if (r.config.file && !cfgBad) {
    chip.innerHTML = `<b>${esc(r.config.fileDisplay)}</b> · saved ${esc(timeAgo(r.config.modified))}`;
  } else {
    chip.innerHTML = '<b>Burp settings not found</b> · click to choose the file';
  }
  $('#copyBtn').disabled = !!cfgBad;
  $('#exportBtn').disabled = !!cfgBad;

  if (cfgBad) {
    showWelcome(cfgBad.detail);
    return;
  }

  $('#welcome').classList.add('hidden');
  $('#results').classList.remove('hidden');
  renderEnv();
  renderCounts();
  if (!state.userPickedFilter) {
    const s = r.summary;
    state.filter = (s.errors + s.warnings) > 0 ? 'problems' : s.notLoaded > 0 ? 'notloaded' : 'all';
  }
  syncFilterButtons();
  renderList();
}

function renderEnv() {
  const row = $('#envRow');
  row.innerHTML = state.result.environment.map(e => {
    const st = STATUS[e.status] || STATUS.info;
    const bad = e.status === 'error' || e.status === 'warning';
    return `<div class="env ${bad ? 'bad' : ''}" style="--c:${st.color}" title="${esc(e.detail)}">
      <div class="top">${ico(bad ? st.icon : (ENV_ICON[e.id] || 'info'))}<span>${esc(e.label)}</span></div>
      <div class="val">${esc(e.value)}</div>
      <div class="det">${esc(e.detail)}</div>
    </div>`;
  }).join('');
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.result.extensions.filter(e => {
    if (state.filter === 'problems' && !(e.status === 'error' || e.status === 'warning')) return false;
    if (state.filter === 'notloaded' && e.loaded) return false;
    if (q && !(e.name.toLowerCase().includes(q) || (e.fileDisplay || '').toLowerCase().includes(q) || e.typeLabel.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderCounts() {
  const ex = state.result.extensions;
  $('#cProblems').textContent = ex.filter(e => e.status === 'error' || e.status === 'warning').length;
  $('#cNotLoaded').textContent = ex.filter(e => !e.loaded).length;
  $('#cAll').textContent = ex.length;
}

function syncFilterButtons() {
  for (const b of $$('#filters button')) b.classList.toggle('on', b.dataset.filter === state.filter);
}

function subline(e) {
  if (!e.analyzed) return 'Loaded and running';
  const f = e.findings[0];
  if (!f) return e.loaded ? 'Loaded · all checks passed' : 'All checks passed';
  return f.title;
}

function renderList() {
  const items = filtered();
  const list = $('#list');
  if (!items.length) {
    const r = state.result;
    let msg = 'No extensions match this filter.';
    if (!state.query && state.filter === 'problems') msg = r.summary.notLoaded ? 'No definite errors. Check "Not loaded" for extensions that are switched off.' : 'Every extension is loaded. Nothing needs attention.';
    if (!state.query && state.filter === 'notloaded') msg = 'Every extension is loaded.';
    if (!r.extensions.length) msg = 'Burp has no extensions installed.';
    list.innerHTML = `<div class="list-empty">${ico('ok')}<div>${esc(msg)}</div></div>`;
    state.selected = null;
    renderDetail();
    return;
  }
  const groups = state.filter === 'problems' ? [['', items]] : [
    ['Errors', items.filter(e => e.status === 'error')],
    ['Warnings', items.filter(e => e.status === 'warning')],
    ['No cause found', items.filter(e => e.status === 'unknown')],
    ['Loaded', items.filter(e => e.status === 'loaded')],
  ];
  let html = '';
  for (const [title, arr] of groups) {
    if (!arr.length) continue;
    if (title) html += `<div class="list-group">${esc(title)} · ${arr.length}</div>`;
    for (const e of arr) {
      const st = STATUS[e.status];
      html += `<div class="row ${state.selected === e.id ? 'sel' : ''}" data-id="${e.id}" role="option" style="--c:${st.color}">
        ${ico(st.icon)}
        <div class="name">${esc(e.name)}</div>
        <span class="type">${esc(e.typeLabel)}</span>
        <div class="sub">${esc(subline(e))}</div>
      </div>`;
    }
  }
  list.innerHTML = html;
  if (!items.find(e => e.id === state.selected)) state.selected = items[0].id;
  markSelected();
  renderDetail();
}

function markSelected() {
  for (const row of $$('#list .row')) row.classList.toggle('sel', row.dataset.id === state.selected);
}

function select(id, scroll) {
  state.selected = id;
  markSelected();
  renderDetail();
  if (scroll) {
    const row = $(`#list .row[data-id="${id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

function evidenceHTML(ev) {
  const lines = [];
  if (ev.code != null) {
    const num = ev.line ? String(ev.line) : '';
    const gutter = num ? num + ' │ ' : '';
    lines.push(esc(gutter + ev.code));
  }
  lines.push('<span class="msg">' + esc(ev.message) + '</span>');
  return `<div class="evidence">
    <div class="ev-file">${ico('file', 'sm')}<span>${esc(ev.file)}</span>${ev.line ? `<span class="ln">line ${ev.line}</span>` : ''}</div>
    <pre>${lines.join('\n')}</pre>
  </div>`;
}

function findingHTML(f) {
  const st = STATUS[f.severity] || STATUS.info;
  let h = `<div class="finding" style="--c:${st.color}">
    <div class="f-title">${ico(st.icon)}<span>${esc(f.title)}</span></div>
    <p>${esc(f.detail)}</p>`;
  if (f.evidence) h += evidenceHTML(f.evidence);
  if (f.modules && f.modules.length) {
    h += '<ul class="mods">' + f.modules.map(m => `<li><code>${esc(m.module)}</code><span class="where">${esc(m.where.join(', '))}</span>${m.note ? `<span class="note">${esc(m.note)}</span>` : ''}</li>`).join('') + '</ul>';
  }
  if (f.fix && f.fix.length) {
    h += `<div class="fix"><div class="fix-h">${ico('wrench')}How to fix</div><ol>${f.fix.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
    if (f.code === 'jython') h += `<div style="margin-top:8px"><button class="btn small" data-url="https://www.jython.org/download">${ico('external', 'sm')}Open jython.org downloads</button></div>`;
    h += '</div>';
  }
  return h + '</div>';
}

function renderDetail() {
  const box = $('#detail');
  const r = state.result;
  const e = r && r.extensions.find(x => x.id === state.selected);
  if (!e) {
    const s = r ? r.summary : null;
    box.innerHTML = `<div class="overview">${ico('ok')}<h3>${s && s.notLoaded === 0 ? 'All extensions are loaded' : 'Nothing selected'}</h3>
      <p>${s && s.notLoaded === 0 ? 'Burp is running every installed extension. Turn on "Analyze loaded extensions too" in Settings to check them anyway.' : 'Pick an extension on the left to see the details.'}</p></div>`;
    return;
  }
  const st = STATUS[e.status];
  const tags = [];
  tags.push(`<span class="pill ${e.status}" style="--c:${st.color}">${esc(st.label)}</span>`);
  tags.push(`<span class="tag">${ico(TYPE_ICON[e.type] || 'file')}${esc(e.typeLabel)}</span>`);
  if (e.bapp) tags.push(`<span class="tag">BApp${e.bapp.version ? ' ' + esc(e.bapp.version) : ''}</span>`);
  else tags.push('<span class="tag">Manually added</span>');
  if (e.bapp && e.bapp.author) tags.push(`<span class="tag">by ${esc(e.bapp.author)}</span>`);
  tags.push(`<span class="tag">${e.loaded ? 'Loaded in Burp' : 'Not loaded in Burp'}</span>`);

  let h = `<div class="d-head">
      <div class="big" style="--c:${st.color}">${ico(st.icon)}</div>
      <div style="min-width:0;flex:1">
        <h2>${esc(e.name)}</h2>
        <div class="d-meta">${tags.join('')}</div>
      </div>
    </div>`;
  if (e.bapp && e.bapp.description) h += `<p class="d-desc">${esc(e.bapp.description)}</p>`;
  h += `<div class="pathbox">${ico('file', 'lead sm')}<code title="${esc(e.fileDisplay || e.configuredPath)}"><span>${esc(e.fileDisplay || e.configuredPath || 'No path')}</span></code>
      <button class="btn small ghost" data-act="copypath" title="Copy the full path">${ico('copy', 'sm')}Copy</button>
      <button class="btn small ghost" data-act="folder" title="Open the folder in Explorer">${ico('folder', 'sm')}Show</button>
    </div>`;

  if (!e.analyzed) {
    h += `<div class="section-title">Status</div><div class="finding" style="--c:var(--ok)"><div class="f-title">${ico('ok')}<span>Burp has this extension running</span></div>
      <p>Loaded extensions are not analyzed by default. Turn on "Analyze loaded extensions too" in Settings to run every check on them as well.</p></div>`;
  } else {
    const problems = e.findings.filter(f => f.severity !== 'info' || f.code === 'no-static-cause' || f.code === 'optional-module');
    if (problems.length) {
      h += `<div class="section-title">${e.status === 'unknown' ? 'Result' : plural(e.findings.filter(f => f.severity === 'error' || f.severity === 'warning').length, 'problem')}</div>`;
      h += problems.map(findingHTML).join('');
    }
    if (e.checks.length) {
      h += '<div class="section-title">Checks performed</div><ul class="checks">' + e.checks.map(c => {
        const cs = STATUS[c.status] || STATUS.info;
        return `<li style="--c:${cs.color}">${ico(cs.icon)}<span>${esc(c.label)}</span><span class="note" title="${esc(c.note)}">${esc(c.note)}</span></li>`;
      }).join('') + '</ul>';
    }
  }
  h += `<div class="d-actions">
      <button class="btn" data-act="copymd">${ico('copy')}Copy as Markdown</button>
    </div>`;
  box.innerHTML = h;
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  $('#detailPane').scrollTop = 0;
}

// ------------------------------------------------------------ settings
function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModals() { for (const m of $$('.modal-backdrop')) m.classList.add('hidden'); $('#exportMenu').classList.add('hidden'); }

function openSettings() {
  const s = state.info.settings;
  $('#sConfig').value = s.configPath || '';
  $('#sConfig').placeholder = 'Detect automatically';
  $('#sJython').value = s.jythonPath || '';
  $('#sJava').value = s.javaPath || '';
  $('#sBurp').value = s.burpDir || '';
  $('#sLoaded').checked = !!s.includeLoaded;
  $('#sSkipJy').checked = !!s.skipJython;
  openModal('settingsModal');
}

async function saveSettings() {
  const s = {
    configPath: $('#sConfig').value.trim(),
    jythonPath: $('#sJython').value.trim(),
    javaPath: $('#sJava').value.trim(),
    burpDir: $('#sBurp').value.trim(),
    includeLoaded: $('#sLoaded').checked,
    skipJython: $('#sSkipJy').checked,
  };
  state.info.settings = await window.bec.saveSettings(s);
  closeModals();
  toast('Settings saved');
  scan();
}

// ------------------------------------------------------------ events
function wire() {
  $('#scanBtn').addEventListener('click', scan);
  $('#configChip').addEventListener('click', openSettings);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
  $('#sSave').addEventListener('click', saveSettings);
  $('#sReset').addEventListener('click', () => {
    for (const id of ['sConfig', 'sJython', 'sJava', 'sBurp']) $('#' + id).value = '';
    $('#sLoaded').checked = false;
    $('#sSkipJy').checked = false;
  });
  for (const b of $$('[data-pick]')) {
    b.addEventListener('click', async () => {
      const p = await window.bec.pick(b.dataset.pick);
      if (p) b.parentElement.querySelector('input').value = p;
    });
  }
  for (const m of $$('.modal-backdrop')) {
    m.addEventListener('mousedown', (ev) => { if (ev.target === m) closeModals(); });
  }
  for (const c of $$('[data-close]')) c.addEventListener('click', closeModals);

  $('#exportBtn').addEventListener('click', (ev) => { ev.stopPropagation(); $('#exportMenu').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('#exportMenu').classList.add('hidden'));
  for (const b of $$('#exportMenu button')) {
    b.addEventListener('click', async () => {
      $('#exportMenu').classList.add('hidden');
      const r = await window.bec.exportReport(b.dataset.fmt);
      if (r && r.path) toast('Saved ' + r.name);
      else if (r && r.error) toast(r.error, 'error');
    });
  }
  $('#copyBtn').addEventListener('click', async () => { if (await window.bec.copyReport()) toast('Report copied as Markdown'); });

  for (const b of $$('#filters button')) {
    b.addEventListener('click', () => { state.filter = b.dataset.filter; state.userPickedFilter = true; syncFilterButtons(); renderList(); });
  }
  $('#search').addEventListener('input', (ev) => { state.query = ev.target.value; renderList(); });

  $('#list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.row');
    if (row) select(row.dataset.id);
  });

  $('#detail').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.url) { window.bec.openExternal(b.dataset.url); return; }
    const e = state.result.extensions.find(x => x.id === state.selected);
    if (!e) return;
    if (b.dataset.act === 'copypath') { await window.bec.copyText(e.file || e.configuredPath); toast('Path copied'); }
    if (b.dataset.act === 'folder') { if (!(await window.bec.showPath(e.id, 'folder'))) toast('The folder does not exist any more', 'warning'); }
    if (b.dataset.act === 'copymd') { if (await window.bec.copyExtension(e.id)) toast('Copied ' + e.name + ' as Markdown'); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeModals(); return; }
    if (ev.key === 'F5' || (ev.ctrlKey && ev.key.toLowerCase() === 'r')) { ev.preventDefault(); scan(); return; }
    if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && state.result && !$('.modal-backdrop:not(.hidden)')) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' && document.activeElement.id !== 'search') return;
      const rows = $$('#list .row');
      if (!rows.length) return;
      ev.preventDefault();
      let i = rows.findIndex(r => r.dataset.id === state.selected);
      i = ev.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      select(rows[i].dataset.id, true);
    }
  });
}

// ------------------------------------------------------------ README screenshots
async function screenshotTour() {
  const pick = (name) => {
    const e = state.result.extensions.find(x => x.name === name);
    if (e) select(e.id, true);
  };
  state.filter = 'problems'; syncFilterButtons(); renderList();
  pick('Access Matrix'); await window.bec.shot('01-python3-error');
  pick('Header Fuzzer'); await window.bec.shot('02-missing-modules');
  pick('Token Inspector'); await window.bec.shot('03-java-version');
  pick('Param Scout'); await window.bec.shot('04-stale-bapp-path');
  state.filter = 'all'; state.userPickedFilter = true; syncFilterButtons(); renderList();
  pick('Response Highlighter'); await window.bec.shot('05-all-extensions');
  openSettings(); await window.bec.shot('06-settings'); closeModals();
  openModal('helpModal'); await window.bec.shot('07-help'); closeModals();
  await window.bec.shotsDone();
}

// ------------------------------------------------------------ start
(async function init() {
  fillIcons();
  $('#logo').innerHTML = ICONS.logo;
  $('#heroLogo').innerHTML = ICONS.logo;
  state.info = await window.bec.info();
  $('#ver').textContent = 'v' + state.info.version;
  if (state.info.demo) $('#demoBadge').classList.remove('hidden');
  wire();
  if (state.info.screenshots) {
    $('#scanMsg').textContent = 'Reading Burp user settings…';
    await window.bec.shot('00-welcome');
  }
  await scan();
  if (state.info.screenshots) await screenshotTour();
})();
