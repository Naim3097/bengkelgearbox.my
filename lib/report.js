/**
 * lib/report.js
 *
 * Phase 9.3 — Diagnostic report renderer.
 *
 * Takes the structured output of analysis-engine.buildReport() plus the 3D
 * capture marks and renders a clean, print-ready HTML document in a new window.
 * The browser's native "Save as PDF" handles export — no PDF library, so 3D
 * screenshots embed as images with zero plumbing and the page prints crisp.
 *
 * Framing follows One X Transmission's diagnosis-first, 4-stage method
 * (Inspection → Disassembly → Restoration → Calibration): this document IS the
 * Stage-1 inspection report — it tells the customer what the scan + drive found,
 * which parts are suspected, and what Stage-2 teardown should confirm.  Every
 * claim is backed by the live signal evidence captured during the drive.
 *
 *   openReport(report, marks, opts)
 */

const SEV = {
  crit: { label: 'CRITICAL', bg: '#7a1f1f', fg: '#ffd9d9', dot: '#ef4444' },
  warn: { label: 'CAUTION',  bg: '#7a571f', fg: '#ffe9c2', dot: '#f59e0b' },
  info: { label: 'INFO',     bg: '#1f4a7a', fg: '#cfe6ff', dot: '#3b82f6' },
};
const CONF = { High: '#ef4444', Medium: '#f59e0b', Low: '#9aa7b2' };
const VERDICT = {
  'HEALTHY':         { bg: '#10391f', fg: '#7ef0a8', accent: '#22c55e' },
  'MONITOR':         { bg: '#3a2f10', fg: '#ffd56b', accent: '#f59e0b' },
  'NEEDS ATTENTION': { bg: '#3a1414', fg: '#ff9b9b', accent: '#ef4444' },
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtClock = (ms, startMs) => {
  const s = Math.max(0, Math.round((ms - startMs) / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

// Build the full report document HTML (exported for testing / future "save to
// file").  openReport() opens it in a new window for print-to-PDF.
export function renderReportHtml(report, marks = [], opts = {}) {
  return buildHtml(report, marks, opts);
}

export function openReport(report, marks = [], opts = {}) {
  const html = buildHtml(report, marks, opts);
  const w = window.open('', '_blank');
  if (!w) { alert('Report blocked by pop-up blocker — allow pop-ups for this page and retry.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function buildHtml(R, marks, opts) {
  const v = VERDICT[R.verdict] || VERDICT['MONITOR'];
  const startMs = R.summary?.startMs ?? (R.meta?.generatedAtMs - (R.summary?.durationMs || 0));
  const vehicle = opts.vehicle || 'Proton Preve · Punch VT2 CVT';
  const tech = opts.technician || '________________';
  const dateStr = opts.dateStr || '';
  const sessionId = opts.sessionId || 'live-capture';

  // group marks: those tagged to a finding vs free gallery
  const taggedByMode = {};
  for (const m of marks) if (m.findingModeId) (taggedByMode[m.findingModeId] ||= []).push(m);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>One X Transmission — CVT Diagnostic Report</title>
<style>${CSS}</style></head>
<body>
<div class="toolbar no-print">
  <strong>CVT Diagnostic Report</strong>
  <span>Native browser print → "Save as PDF" for the customer copy.</span>
  <button onclick="window.print()">⎙ Print / Save PDF</button>
</div>

<!-- ── COVER / HEADER ─────────────────────────────────────────────── -->
<header class="cover">
  <div class="brand">
    <div class="logo">ONE&nbsp;X<span>TRANSMISSION</span></div>
    <div class="tagline">CVT &amp; Automatic Specialist · Diagnosis First</div>
  </div>
  <h1>CVT Diagnostic Inspection Report</h1>
  <table class="cover-meta">
    <tr><td>Vehicle / unit</td><td>${esc(vehicle)}</td></tr>
    <tr><td>Date</td><td>${esc(dateStr)}</td></tr>
    <tr><td>Capture source</td><td>${esc(sessionId)}</td></tr>
    <tr><td>Drive duration</td><td>${esc(R.summary.durationStr)} · ${esc(R.summary.distanceKm)} km</td></tr>
    <tr><td>Technician</td><td>${esc(tech)}</td></tr>
  </table>
  <div class="verdict" style="background:${v.bg};color:${v.fg};border-color:${v.accent}">
    <div class="verdict-l">
      <div class="vk">ASSESSMENT</div>
      <div class="vv">${esc(R.verdict)}</div>
      <div class="vn">${esc(R.verdictNote)}</div>
    </div>
    <div class="score" style="border-color:${v.accent}">
      <div class="sn">${R.healthScore}</div><div class="sl">/100<br>health</div>
    </div>
  </div>
</header>

<!-- ── METHOD NOTE ────────────────────────────────────────────────── -->
<section class="method">
  <h2>How this assessment was made</h2>
  <p>This report is the <b>Stage&nbsp;1 inspection</b> of One X Transmission's four-stage method
  (<b>Inspection → Disassembly → Restoration → Calibration</b>). It is built from the vehicle's
  own live transmission data, captured over a real drive through the diagnostic scanner — not from
  guesswork. Every finding below cites the actual signal that produced it, with the operating
  condition it occurred under. The goal is to identify the <b>root cause before any part is removed</b>,
  so the customer pays to fix the real problem, not to chase symptoms.</p>
</section>

<!-- ── COVERAGE ───────────────────────────────────────────────────── -->
<section>
  <h2>What this drive tested</h2>
  <p class="muted">A diagnosis is only as good as the conditions it was taken under. This is exactly what the unit was asked to do during the capture:</p>
  <div class="cov-grid">
    ${covCard('Top speed', R.coverage.maxV_kph + ' km/h')}
    ${covCard('Peak throttle', R.coverage.maxThrottle + ' %')}
    ${covCard('Max fluid temp', R.coverage.thermalMax + ' °C')}
    ${covCard('Load test (WOT/launch)', R.coverage.didLoadTest ? 'Yes ✓' : 'Not captured', !R.coverage.didLoadTest)}
    ${covCard('Reverse engaged', R.coverage.didReverse ? 'Yes ✓' : 'Not captured', !R.coverage.didReverse)}
    ${covCard('Highway / overdrive', R.coverage.didHighway ? 'Yes ✓' : 'Not captured', !R.coverage.didHighway)}
    ${R.coverage.geo
      ? covCard('Road grade (GPS)', R.coverage.minGrade != null ? `${R.coverage.minGrade}% … ${R.coverage.maxGrade > 0 ? '+' : ''}${R.coverage.maxGrade}%` : '—')
        + covCard('Climb / descent', [R.coverage.didClimb && 'climb', R.coverage.didDescend && 'descent'].filter(Boolean).join(' + ') || 'flat only', !(R.coverage.didClimb || R.coverage.didDescend))
        + covCard('Cornering', R.coverage.didCorner ? 'Yes ✓' : 'Straight-line', !R.coverage.didCorner)
      : covCard('Road grade (GPS)', 'Not captured', true)}
  </div>
  ${R.caveats.length ? `<div class="caveat"><b>Test-coverage limits:</b><ul>${R.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
</section>

<!-- ── FINDINGS ───────────────────────────────────────────────────── -->
<section>
  <h2>Findings &amp; suspected components</h2>
  ${R.findings.length === 0
    ? `<div class="ok-box">No fault evidence was detected within the operating points tested. The transmission behaved within healthy limits for every signal observed. ${R.caveats.length ? 'Note the test-coverage limits above — a clean result does not certify untested conditions.' : ''}</div>`
    : R.findings.map((f, i) => findingCard(f, i, taggedByMode[f.modeId] || [], startMs)).join('')}
</section>

<!-- ── 3D CAPTURE GALLERY ─────────────────────────────────────────── -->
${marks.length ? `<section class="page-break">
  <h2>Captured 3D states</h2>
  <p class="muted">Snapshots marked during the drive — the live 3D model frozen at the moment of interest, with the telemetry at that instant.</p>
  <div class="gallery">
    ${marks.map((m, i) => markCard(m, i, startMs)).join('')}
  </div>
</section>` : ''}

<!-- ── LIVE DATA SUMMARY ──────────────────────────────────────────── -->
<section>
  <h2>Live data summary</h2>
  <table class="data">
    <tr><th>Signal</th><th>Observed range / value</th><th>Basis</th></tr>
    ${dataRow('Vehicle speed (max)', R.summary.maxV_kph + ' km/h', 'measured')}
    ${dataRow('Engine speed (max)', R.summary.maxRpm + ' rpm', 'measured')}
    ${dataRow('Variator ratio', R.summary.ratioRange, 'derived')}
    ${dataRow('Line pressure', R.summary.lineRange, 'measured')}
    ${dataRow('Secondary clamp', R.summary.secRange, 'measured')}
    ${dataRow('Fluid temperature', R.summary.oilRange, 'measured')}
    ${dataRow('EDS1 / EDS2 mean current', R.summary.eds1Mean + ' / ' + R.summary.eds2Mean + ' mA', 'measured')}
    ${dataRow('Belt slip (peak)', R.summary.beltSlipMax + ' %', 'derived')}
    ${dataRow('Clutch slip (peak)', R.summary.clutchSlipMax + ' %', 'estimated')}
    ${R.summary.geo ? dataRow('Road grade', R.summary.gradeRange, 'derived') : ''}
    ${R.summary.geo ? dataRow('Road-load (input torque)', R.summary.roadLoadRange, 'derived') : ''}
  </table>
</section>

<!-- ── DTC APPENDIX ───────────────────────────────────────────────── -->
${R.dtcCount ? `<section>
  <h2>Stored fault codes (from the TCM)</h2>
  <table class="data">
    <tr><th>Code</th><th>Attributed to</th><th>Times seen</th></tr>
    ${R.findings.flatMap(f => f.dtcs.map(d => `<tr><td><b>${esc(d.code)}</b></td><td>${esc(f.title)}</td><td>${d.count}</td></tr>`)).join('')}
  </table>
</section>` : '<section><p class="muted"><b>No stored fault codes</b> were reported by the transmission control module during the scan.</p></section>'}

<!-- ── PROVENANCE / FOOTER ────────────────────────────────────────── -->
<section class="prov">
  <h2>Data provenance &amp; method notes</h2>
  <ul>
    <li><b>Measured</b> signals are read directly off the vehicle CAN bus and calibrated against the Punch VT2/VT3 service data (pressures in bar, EDS current in mA, fluid temperature in °C).</li>
    <li><b>Derived</b> signals (pulley speeds, variator ratio, belt slip) are computed from measured anchors using the documented VT2 kinematics — primary speed couples to engine speed in gear; secondary speed = wheel speed × final drive (5.182).</li>
    <li><b>Road conditions</b> (grade, road‑load, cornering) come from the tablet GPS + Google Elevation, fed through the shared road‑load model. When present they set the <i>real</i> clamp‑pressure baseline for the current grade (not just a throttle proxy) and discount expected behaviour — slip on a descent, ratio movement through a corner — so road artefacts aren't reported as faults. The same terrain logic drives the live scanner and this report, so the two never disagree.</li>
    <li><b>Estimated</b> signals (clutch apply pressure / temperature, EDS3) are modelled — the Preve does not broadcast a clutch sensor. Findings resting only on estimated data are capped at "Medium" confidence and flagged accordingly.</li>
    <li>Anomaly thresholds use the same healthy-range envelopes the live scanner displays, so this report never contradicts what was shown on screen.</li>
  </ul>
  <div class="sign">
    <div>Generated by SXAN CVT Scanner · ${esc(opts.version || 'v1.x')}</div>
    <div class="sigline">Inspected by: <span>${esc(tech)}</span> &nbsp;·&nbsp; Signature: ____________________</div>
  </div>
  <p class="disclaimer">This is a scan-based diagnostic assessment intended to direct a physical Stage-2 inspection. Final confirmation of any suspected component requires teardown, measurement, and bench testing as described in each finding. © One X Transmission.</p>
</section>

</body></html>`;
}

function covCard(label, value, warn) {
  return `<div class="cov-card${warn ? ' warn' : ''}"><div class="cov-v">${esc(value)}</div><div class="cov-l">${esc(label)}</div></div>`;
}

function dataRow(label, value, basis) {
  const bcol = basis === 'measured' ? '#22c55e' : basis === 'derived' ? '#3b82f6' : '#f59e0b';
  return `<tr><td>${esc(label)}</td><td><b>${esc(value)}</b></td><td><span class="basis" style="color:${bcol}">${esc(basis)}</span></td></tr>`;
}

function findingCard(f, i, marks, startMs) {
  const sv = SEV[f.severity] || SEV.warn;
  const evidence = f.events.map(e => {
    const dur = (e.durationMs / 1000).toFixed(1);
    const terr = e.gradeState ? ` · ${esc(e.gradeState)}${e.grade != null ? ` (${e.grade > 0 ? '+' : ''}${esc(e.grade)}%)` : ''}${e.cornering ? ', cornering' : ''}` : '';
    return `<li><b>${esc(e.label)}</b> — peak ${esc(e.peak)} (${esc(e.peakSig)}), ${dur}s under <i>${esc(e.opBucket)}</i>${terr} <span class="basis-tag ${e.basis}">${e.basis}</span></li>`;
  }).join('');
  // road-condition description for this finding (terrain-aware diagnosis note)
  const terrBits = [];
  if (f.terrain && f.terrain.geo) {
    const g = f.terrain.grades || [];
    if (g.includes('climb')) terrBits.push('climbing');
    if (g.includes('descend')) terrBits.push('descending');
    if (g.includes('level')) terrBits.push('on the level');
    if (f.terrain.cornering) terrBits.push('cornering');
  }
  const terrDesc = terrBits.join(' / ');
  const dtcs = f.dtcs.map(d => `<span class="dtc-chip">${esc(d.code)} ×${d.count}</span>`).join(' ');
  const parts = f.partRefs.map(p =>
    `<tr><td>${esc(p.name)}</td><td>${esc(p.pn)}</td><td>${esc(p.action)}</td></tr>`).join('');
  const figs = marks.map((m, k) => `<figure class="fig"><img src="${m.img}" alt="3D capture"><figcaption>Captured ${fmtClock(m.tMs, startMs)} — ${esc(m.label || 'state')}</figcaption></figure>`).join('');
  // Purpose-built figure: the suspected component framed + highlighted (set at report time).
  const figMain = f.figure ? `<figure class="fig fig-main"><img src="${f.figure}" alt="${esc(f.component)}"><figcaption><b>Suspected component:</b> ${esc(f.component)}</figcaption></figure>` : '';

  return `<article class="finding sev-${f.severity}">
    <div class="f-head">
      <span class="rank">#${i + 1}</span>
      <div class="f-title">
        <h3>${esc(f.title)}</h3>
        <div class="f-comp">${esc(f.component)}</div>
      </div>
      <div class="f-badges">
        <span class="badge" style="background:${sv.bg};color:${sv.fg}">${sv.label}</span>
        <span class="badge conf" style="border-color:${CONF[f.confidence]};color:${CONF[f.confidence]}">${f.confidence} confidence</span>
        ${f.estimatedOnly ? '<span class="badge est">est. data</span>' : ''}
      </div>
    </div>

    ${(figMain || figs) ? `<div class="f-figs">${figMain}${figs}</div>` : ''}

    ${f.driverSymptoms.length ? `<div class="f-block"><h4>What the driver feels</h4><ul>${f.driverSymptoms.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}

    <div class="f-block"><h4>Why it happens</h4><p>${esc(f.mechanism)}</p>${f.realWorldNote ? `<p class="note">${esc(f.realWorldNote)}</p>` : ''}</div>

    <div class="f-block"><h4>Evidence from this drive</h4>
      ${evidence ? `<ul class="evidence">${evidence}</ul>` : '<p class="muted">No live excursion captured — this finding rests on the stored fault code(s) below.</p>'}
      ${dtcs ? `<div class="dtc-row">Stored codes: ${dtcs}</div>` : ''}
    </div>

    ${terrDesc ? `<div class="f-block"><h4>Road conditions</h4><p class="note">This evidence was captured while <b>${esc(terrDesc)}</b>. The diagnosis is terrain‑aware — expected belt slip on a descent and ratio movement through a corner are automatically discounted — so this finding <b>survived that adjustment</b> and is not merely a road‑condition artefact.</p></div>` : ''}

    ${parts ? `<div class="f-block"><h4>Suspected parts &amp; what to check (Stage 2)</h4>
      <table class="parts"><tr><th>Component</th><th>Part&nbsp;No.</th><th>Action</th></tr>${parts}</table></div>` : ''}

    <div class="f-action"><b>Recommended next step:</b> ${esc(f.oneXAction)}</div>
  </article>`;
}

function markCard(m, i, startMs) {
  const snap = m.snapshot || {};
  const chip = (k, lbl, u = '') => snap[k] != null ? `<span>${esc(lbl)} <b>${typeof snap[k] === 'number' ? (+snap[k]).toFixed(k === 'ratio' ? 2 : 0) : esc(snap[k])}${u}</b></span>` : '';
  return `<figure class="gcard">
    <img src="${m.img}" alt="3D capture ${i + 1}">
    <figcaption>
      <div class="gtitle">${esc(m.label || ('Mark ' + (i + 1)))} <span class="gtime">${fmtClock(m.tMs, startMs)}${m.kind === 'auto' ? ' · auto' : ''}</span></div>
      <div class="gchips">
        ${chip('selector', 'Gear')}${chip('V_kph', 'Spd', ' km/h')}${chip('N_MOT', 'RPM')}
        ${chip('ratio', 'Ratio')}${chip('P_line', 'Line', ' bar')}${chip('T_oil', 'Oil', '°C')}
      </div>
      ${m.note ? `<div class="gnote">${esc(m.note)}</div>` : ''}
    </figcaption>
  </figure>`;
}

const CSS = `
* { box-sizing: border-box; }
body { margin:0; font:14px/1.55 -apple-system,'Segoe UI',Roboto,Arial,sans-serif; color:#1c2530; background:#eef1f4; }
section, header.cover { max-width: 900px; margin: 0 auto; padding: 22px 34px; background:#fff; }
header.cover { padding-top: 30px; }
h1 { font-size: 26px; margin: 6px 0 16px; letter-spacing:-.01em; }
h2 { font-size: 18px; margin: 4px 0 12px; padding-bottom:6px; border-bottom:2px solid #e3e8 ; border-bottom:2px solid #e3e8ee; color:#0f1822; }
h3 { font-size: 16px; margin: 0; }
h4 { font-size: 12.5px; text-transform: uppercase; letter-spacing:.06em; color:#5a6b78; margin: 12px 0 5px; }
p { margin: 6px 0; }
ul { margin: 5px 0 5px 0; padding-left: 20px; }
li { margin: 3px 0; }
.muted { color:#6a7884; font-size:13px; }
.note { color:#5a6b78; font-style:italic; font-size:13px; background:#f4f7f9; border-left:3px solid #b9c6d0; padding:6px 10px; }

/* toolbar */
.toolbar { position:sticky; top:0; z-index:9; display:flex; gap:14px; align-items:center; background:#0f1822; color:#cfe0ea; padding:10px 20px; font-size:13px; }
.toolbar button { margin-left:auto; background:#22c55e; color:#06240f; border:0; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer; }
.toolbar button:hover { filter:brightness(1.1); }

/* cover */
.brand { display:flex; justify-content:space-between; align-items:baseline; border-bottom:3px solid #0f1822; padding-bottom:10px; }
.logo { font-size:24px; font-weight:800; letter-spacing:.04em; color:#0f1822; }
.logo span { color:#159; color:#1a7fa3; margin-left:6px; font-weight:700; }
.tagline { color:#5a6b78; font-size:12.5px; text-transform:uppercase; letter-spacing:.08em; }
.cover-meta { width:100%; border-collapse:collapse; margin:6px 0 18px; }
.cover-meta td { padding:5px 8px; border-bottom:1px solid #eef1f4; font-size:13.5px; }
.cover-meta td:first-child { color:#6a7884; width:170px; }
.verdict { display:flex; justify-content:space-between; align-items:center; border:2px solid; border-radius:10px; padding:16px 22px; }
.vk { font-size:11px; letter-spacing:.18em; opacity:.8; }
.vv { font-size:30px; font-weight:800; letter-spacing:-.01em; }
.vn { font-size:13px; opacity:.9; margin-top:2px; max-width:520px; }
.score { display:flex; align-items:baseline; gap:4px; border:3px solid; border-radius:10px; padding:10px 16px; }
.sn { font-size:38px; font-weight:800; line-height:1; }
.sl { font-size:11px; line-height:1.1; }

/* method */
.method p { font-size:13.5px; }

/* coverage */
.cov-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:12px 0; }
.cov-card { background:#f4f7f9; border:1px solid #e3e8ee; border-radius:8px; padding:12px 14px; }
.cov-card.warn { background:#fff7ed; border-color:#fed7aa; }
.cov-v { font-size:19px; font-weight:700; color:#0f1822; }
.cov-card.warn .cov-v { color:#c2620a; }
.cov-l { font-size:11.5px; color:#6a7884; text-transform:uppercase; letter-spacing:.04em; margin-top:2px; }
.caveat { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:10px 14px; font-size:13px; color:#7a4a14; margin-top:8px; }
.caveat ul { margin:4px 0 0; }

/* findings */
.ok-box { background:#10391f10; border:1px solid #22c55e; border-left:5px solid #22c55e; border-radius:8px; padding:14px 16px; color:#16602f; }
.finding { border:1px solid #e3e8ee; border-radius:10px; padding:0 0 14px; margin:14px 0; overflow:hidden; break-inside:avoid; }
.finding.sev-crit { border-left:6px solid #ef4444; }
.finding.sev-warn { border-left:6px solid #f59e0b; }
.finding.sev-info { border-left:6px solid #3b82f6; }
.f-head { display:flex; align-items:center; gap:12px; padding:14px 16px; background:#f4f7f9; }
.rank { font-size:20px; font-weight:800; color:#9aa7b2; }
.f-title { flex:1; }
.f-comp { font-size:12.5px; color:#5a6b78; }
.f-badges { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.badge { font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:20px; letter-spacing:.04em; }
.badge.conf { background:#fff; border:1.5px solid; }
.badge.est { background:#fef3c7; color:#92600a; }
.f-block { padding:0 16px; }
.f-block p { font-size:13.5px; }
.evidence li { font-size:13px; }
.basis-tag { font-size:10px; padding:1px 6px; border-radius:10px; margin-left:4px; }
.basis-tag.measured { background:#dcfce7; color:#15803d; }
.basis-tag.derived { background:#dbeafe; color:#1e5fae; }
.basis-tag.estimated { background:#fef3c7; color:#92600a; }
.dtc-row { margin:6px 0; font-size:13px; }
.dtc-chip { display:inline-block; background:#0f1822; color:#ff9b9b; font-weight:700; font-size:12px; padding:2px 8px; border-radius:4px; margin:0 3px; font-family:'JetBrains Mono',monospace; }
table.parts, table.data { width:100%; border-collapse:collapse; margin:6px 0; font-size:13px; }
table.parts th, table.data th { text-align:left; background:#0f1822; color:#cfe0ea; padding:6px 9px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
table.parts td, table.data td { padding:6px 9px; border-bottom:1px solid #eef1f4; vertical-align:top; }
.basis { font-weight:700; font-size:12px; text-transform:uppercase; }
.f-action { margin:12px 16px 0; background:#0f1822; color:#eafff2; border-radius:8px; padding:11px 14px; font-size:13.5px; }
.f-figs { display:flex; gap:10px; flex-wrap:wrap; padding:12px 16px 0; }
.fig { margin:0; width:240px; }
.fig img { width:100%; border:1px solid #cfd8e0; border-radius:6px; background:#05080b; }
.fig figcaption { font-size:11px; color:#6a7884; margin-top:3px; }
.fig-main { width:330px; }   /* purpose-built component figure — the headline image */
.fig-main img { border:2px solid #2a8fa3; }
.fig-main figcaption { color:#2a8fa3; }

/* gallery */
.gallery { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
.gcard { margin:0; border:1px solid #e3e8ee; border-radius:8px; overflow:hidden; break-inside:avoid; }
.gcard img { width:100%; display:block; background:#05080b; }
.gcard figcaption { padding:8px 10px; }
.gtitle { font-weight:700; font-size:13.5px; }
.gtime { color:#6a7884; font-weight:400; font-size:11.5px; }
.gchips { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; font-size:11.5px; color:#5a6b78; }
.gchips b { color:#0f1822; }
.gnote { font-size:12px; color:#5a6b78; margin-top:4px; font-style:italic; }

/* provenance */
.prov ul { font-size:12.5px; color:#41505c; }
.sign { display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:10px; border-top:1px solid #e3e8ee; font-size:12px; color:#6a7884; }
.sigline span { color:#1c2530; font-weight:600; }
.disclaimer { font-size:11px; color:#8a97a2; margin-top:10px; }

@media print {
  body { background:#fff; }
  .no-print { display:none !important; }
  section, header.cover { max-width:none; padding:14px 18px; }
  .page-break { page-break-before: always; }
  .finding, .gcard, .fig { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
