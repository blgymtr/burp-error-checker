'use strict';
// Report writers: Markdown, HTML (self-contained) and JSON.
// Absolute paths are never written; reports use the shortened display paths.

const STATUS_LABEL = { error: 'Error', warning: 'Warning', unknown: 'No cause found', loaded: 'Loaded', ok: 'OK', info: 'Info' };
const ICON = { error: '✖', warning: '▲', info: 'ℹ', ok: '✔', unknown: '?', loaded: '✔' };

function publicResult(r) {
  // strip absolute paths and raw source for sharing
  const clean = JSON.parse(JSON.stringify(r));
  delete clean.config.dir; delete clean.config.file;
  if (clean.burp) delete clean.burp.installDir;
  if (clean.jython) delete clean.jython.path;
  if (clean.checkerJava) delete clean.checkerJava.path;
  for (const e of clean.extensions) {
    delete e.file; delete e.folder;
    e.configuredPath = e.configuredDisplay;
    if (e.bapp) { delete e.bapp.dir; delete e.bapp.manifest; }
  }
  return clean;
}

function toJSON(r) {
  return JSON.stringify(publicResult(r), null, 2);
}

function toMarkdown(r) {
  const L = [];
  const s = r.summary;
  L.push('# Burp extension diagnosis');
  L.push('');
  L.push('Generated ' + new Date(r.generatedAt).toUTCString() + ' by Burp Error Checker' + (r.version ? ' ' + r.version : '') + '.');
  L.push('');
  L.push('| Extensions | Loaded | Not loaded | Errors | Warnings | No cause found |');
  L.push('|---:|---:|---:|---:|---:|---:|');
  L.push(`| ${s.total} | ${s.loaded} | ${s.notLoaded} | ${s.errors} | ${s.warnings} | ${s.unknown} |`);
  L.push('');
  L.push('## Environment');
  L.push('');
  L.push('| | Item | Value | Details |');
  L.push('|---|---|---|---|');
  for (const e of r.environment) L.push(`| ${ICON[e.status] || ''} | ${e.label} | ${e.value} | ${String(e.detail).replace(/\|/g, '\\|')} |`);
  L.push('');
  const analyzed = r.extensions.filter(e => e.analyzed);
  L.push('## Extensions');
  L.push('');
  if (!analyzed.length) L.push('_Every extension is loaded. Nothing to diagnose._');
  for (const e of analyzed) {
    L.push(`### ${ICON[e.status] || ''} ${e.name}`);
    L.push('');
    L.push(`**Status:** ${STATUS_LABEL[e.status]} · **Type:** ${e.typeLabel}` + (e.bapp && e.bapp.version ? ` · **BApp version:** ${e.bapp.version}` : '') + ` · **File:** \`${e.fileDisplay || e.configuredDisplay}\``);
    L.push('');
    for (const f of e.findings) {
      L.push(`**${ICON[f.severity]} ${f.title}**`);
      L.push('');
      L.push(f.detail);
      L.push('');
      if (f.evidence) {
        L.push('```');
        L.push(f.evidence.file + (f.evidence.line ? ':' + f.evidence.line : ''));
        if (f.evidence.code) L.push('    ' + f.evidence.code.trim());
        L.push(f.evidence.message);
        L.push('```');
        L.push('');
      }
      if (f.modules) {
        for (const m of f.modules) L.push(`- \`${m.module}\` (imported at ${m.where.join(', ')})` + (m.note ? ' — ' + m.note : ''));
        L.push('');
      }
      if (f.fix && f.fix.length) {
        L.push('How to fix:');
        L.push('');
        f.fix.forEach((x, i) => L.push(`${i + 1}. ${x}`));
        L.push('');
      }
    }
    if (e.checks.length) {
      L.push('<details><summary>Checks performed</summary>');
      L.push('');
      for (const c of e.checks) L.push(`- ${ICON[c.status] || ''} ${c.label}${c.note ? ': ' + c.note : ''}`);
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }
  const loaded = r.extensions.filter(e => !e.analyzed);
  if (loaded.length) {
    L.push('## Loaded extensions (not analyzed)');
    L.push('');
    for (const e of loaded) L.push(`- ${e.name} (${e.typeLabel})`);
    L.push('');
  }
  return L.join('\n');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toHTML(r) {
  const s = r.summary;
  const color = { error: '#ff5c6c', warning: '#f5b445', info: '#6aa8ff', ok: '#3ddc97', unknown: '#9aa6bd', loaded: '#3ddc97' };
  const pill = (st) => `<span class="pill" style="--c:${color[st]}">${esc(STATUS_LABEL[st] || st)}</span>`;
  const body = [];
  body.push(`<header><h1>Burp extension diagnosis</h1><p>Generated ${esc(new Date(r.generatedAt).toUTCString())} by Burp Error Checker${r.version ? ' ' + esc(r.version) : ''}</p></header>`);
  body.push('<section class="stats">' + [
    ['Extensions', s.total], ['Loaded', s.loaded], ['Not loaded', s.notLoaded], ['Errors', s.errors], ['Warnings', s.warnings], ['No cause found', s.unknown],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('') + '</section>');
  body.push('<h2>Environment</h2><table>' + r.environment.map(e => `<tr><td>${pill(e.status)}</td><td><b>${esc(e.label)}</b><br><small>${esc(e.value)}</small></td><td>${esc(e.detail)}</td></tr>`).join('') + '</table>');
  body.push('<h2>Extensions</h2>');
  const analyzed = r.extensions.filter(e => e.analyzed);
  if (!analyzed.length) body.push('<p>Every extension is loaded. Nothing to diagnose.</p>');
  for (const e of analyzed) {
    body.push(`<article><h3>${esc(e.name)} ${pill(e.status)}</h3><p class="meta">${esc(e.typeLabel)}${e.bapp && e.bapp.version ? ' · BApp ' + esc(e.bapp.version) : ''} · <code>${esc(e.fileDisplay || e.configuredDisplay)}</code></p>`);
    for (const f of e.findings) {
      body.push(`<div class="finding" style="--c:${color[f.severity]}"><h4>${esc(f.title)}</h4><p>${esc(f.detail)}</p>`);
      if (f.evidence) body.push(`<pre>${esc(f.evidence.file)}${f.evidence.line ? ':' + f.evidence.line : ''}\n${f.evidence.code ? '    ' + esc(f.evidence.code.trim()) + '\n' : ''}${esc(f.evidence.message)}</pre>`);
      if (f.modules) body.push('<ul>' + f.modules.map(m => `<li><code>${esc(m.module)}</code> <small>${esc(m.where.join(', '))}</small>${m.note ? '<br><small>' + esc(m.note) + '</small>' : ''}</li>`).join('') + '</ul>');
      if (f.fix && f.fix.length) body.push('<p class="fixh">How to fix</p><ol>' + f.fix.map(x => `<li>${esc(x)}</li>`).join('') + '</ol>');
      body.push('</div>');
    }
    if (e.checks.length) body.push('<details><summary>Checks performed</summary><ul class="checks">' + e.checks.map(c => `<li style="--c:${color[c.status]}">${esc(c.label)}${c.note ? ': <small>' + esc(c.note) + '</small>' : ''}</li>`).join('') + '</ul></details>');
    body.push('</article>');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Burp extension diagnosis</title><style>
:root{color-scheme:dark}body{margin:0;background:#0d1117;color:#e6ebf5;font:14px/1.55 "Segoe UI",system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:32px 24px 64px}
h1{margin:0;font-size:26px}h2{margin:34px 0 12px;font-size:18px;color:#9fb0cc;text-transform:uppercase;letter-spacing:.08em}header p{color:#8b97ad;margin:4px 0 0}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:22px}.stats div{background:#151b26;border:1px solid #232c3d;border-radius:12px;padding:12px}.stats b{display:block;font-size:22px}.stats span{color:#8b97ad;font-size:12px}
table{width:100%;border-collapse:collapse;background:#151b26;border-radius:12px;overflow:hidden}td{padding:10px 12px;border-top:1px solid #232c3d;vertical-align:top}small{color:#8b97ad}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;color:var(--c);background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);vertical-align:middle}
article{background:#151b26;border:1px solid #232c3d;border-radius:14px;padding:18px 20px;margin:14px 0}article h3{margin:0;font-size:17px}.meta{color:#8b97ad;margin:4px 0 10px}code,pre{font-family:"Cascadia Code",Consolas,monospace;font-size:12.5px}
pre{background:#0b0f16;border:1px solid #232c3d;border-radius:8px;padding:10px 12px;white-space:pre-wrap}.finding{border-left:3px solid var(--c);padding:2px 0 2px 14px;margin:14px 0}.finding h4{margin:0 0 4px;color:var(--c)}.fixh{font-weight:600;margin-bottom:0}
.checks li::marker{color:var(--c)}details summary{cursor:pointer;color:#9fb0cc}
</style></head><body><main>${body.join('\n')}</main></body></html>`;
}

module.exports = { toMarkdown, toHTML, toJSON, publicResult };
