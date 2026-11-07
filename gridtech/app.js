import { COLORS, NAMES, ICONS, dot, fmt, fmt0, donut, capacityBars, barGroups, delayCurve, annualChart, eventTrace, waitingCurve } from './charts.js?v=5';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
import { localApi as api } from './client-api.js?v=5';
const M = v => '$' + fmt(v, Math.abs(v) >= 100 ? 0 : 1) + 'M';
const V = { cost: [230, 36], speed: [36, 372], env: [424, 372] };
const tip = t => `<p class="insight"><span>Takeaway</span>${t}</p>`;
const OWN = ['gas_turbine', 'gas_engine', 'fuel_cell'];
const listNames = caps => Object.entries(caps).filter(([, v]) => v > 0).map(([k, v]) => `${fmt0(v)} MW of ${NAMES[k].toLowerCase()}`);
const joinAnd = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

/* ------------------------------------------------------------------ state */
const AX = [
  { k: 'speed', name: 'Speed', help: 'How soon the campus is fully running.', metrics: [['full', 'Full-demand month'], ['start', 'Service start month']] },
  { k: 'cost', name: 'Cost', help: 'What the plan costs over ten years.', metrics: [['usd_mwh', '$ per MWh (cost per unit of energy)'], ['total_musd', '10-year total ($M)'], ['running_musd', 'Running cost only (no equipment charges)'], ['pct_over', '% over the cheapest plan']] },
  { k: 'env', name: 'Environment', help: 'How much CO2 the electricity causes.', metrics: [['kg', 'kg of CO2 per MWh'], ['clean', 'Clean share (%)'], ['tonnes', 'Total tonnes of CO2 (10 years)']] },
];
const STEP = { full: 1, start: 1, usd_mwh: 0.5, total_musd: 5, running_musd: 5, pct_over: 1, kg: 1, clean: 1, tonnes: 5000 };
const state = {
  weights: { speed: 1 / 3, cost: 1 / 3, env: 1 / 3 },
  limits: { speed: { metric: 'full', limit: null }, cost: { metric: 'usd_mwh', limit: null }, env: { metric: 'kg', limit: null }, never_t2: true },
  switches: { events_off: [], allow_t1: true, allow_t2: true, delay: 0, heat: false, outage: 0, degradation: 0, gas_limit_mmbtu_h: 0, startup_costs: false, gas_mult: 1, renew_mult: 1 },
  hurdle: 100, pin: null, premium: { on: false, pct: 10, ref: 30 }, valueMonth: 0,
};
let META, LIBPTS, QS, DEMO, ARCH, FWK, last = null, selEvent = 0, scnTimer, scnSeq = 0;

/* ------------------------------------------------------------------ tabs */
const TABS = ['home', 'studio', 'stress', 'scenarios', 'questions', 'export'];
function showTab(t, scroll) {
  if (!TABS.includes(t)) t = 'home';
  $$('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + t));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
  window.scrollTo(0, 0);
  if (scroll) setTimeout(() => document.getElementById(scroll)?.scrollIntoView(), 30);
}
function initTabs() {
  $$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $$('[data-go]').forEach(b => b.onclick = () => b.dataset.go === 'how' ? showTab('home', 'how') : showTab(b.dataset.go));
  $('.brand').onclick = e => { e.preventDefault(); showTab('home'); };
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1) || 'home');
}
const TERMS = [
  ['Ten-year cost', 'Everything the plan costs over ten years: equipment charges, contracts, fuel, power bought on the market, and penalties if work is moved or paused.'],
  ['Emissions per MWh', 'Kilograms of CO2 released for each unit of electricity used. Lower is cleaner. About 100 kg is a common target.'],
  ['Clean share', 'The part of the campus energy that comes from wind, solar and nuclear contracts. Gas and market power do not count.'],
  ['Grid emergency', 'A short window, 3 to 7 hours, when the grid asks big users to cut back. The campus may then draw only 60% of its connection.'],
  ['Work moved or paused', 'Only during grid emergencies, some work can move to another site for a fee, and some can be paused for a heavy penalty. Essential work is never touched.'],
  ['Opening and full demand', 'The campus opens at one-third load and grows for ten months. Full demand is the opening month plus 10.'],
];

/* ------------------------------------------------------------------ triangle */
const pos = w => [w.cost * V.cost[0] + w.speed * V.speed[0] + w.env * V.env[0], w.cost * V.cost[1] + w.speed * V.speed[1] + w.env * V.env[1]];
function bary(x, y) {
  const [x1, y1] = V.cost, [x2, y2] = V.speed, [x3, y3] = V.env;
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d, l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
  const w = { cost: l1, speed: l2, env: 1 - l1 - l2 };
  for (const k in w) w[k] = Math.max(w[k], 0);
  const t = w.cost + w.speed + w.env;
  for (const k in w) w[k] /= t;
  return w;
}
function buildTri() {
  const svg = $('#tri'), P = (c, s, e) => pos({ cost: c, speed: s, env: e });
  let g = '';
  for (let i = 1; i < 10; i++) {
    const t = i / 10, cls = i === 5 ? 'gridl m' : 'gridl';
    let a = P(t, 1 - t, 0), b = P(t, 0, 1 - t); g += `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
    a = P(1 - t, t, 0); b = P(0, t, 1 - t); g += `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
    a = P(1 - t, 0, t); b = P(0, 1 - t, t); g += `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  }
  svg.innerHTML = `<defs>
    <radialGradient id="tS" cx="0" cy="1" r="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#fff0b8" stop-opacity="0"/></radialGradient>
    <radialGradient id="tC" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#cfe6fa"/><stop offset="1" stop-color="#cfe6fa" stop-opacity="0"/></radialGradient>
    <radialGradient id="tE" cx="1" cy="1" r="1"><stop offset="0" stop-color="#bfe9cb"/><stop offset="1" stop-color="#bfe9cb" stop-opacity="0"/></radialGradient>
    <linearGradient id="leafg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8f0d2"/><stop offset="1" stop-color="#4fb584"/></linearGradient>
    <clipPath id="triclip"><path d="M${V.cost} L${V.speed} L${V.env}Z"/></clipPath>
    <filter id="sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#2f7d5b" flood-opacity=".35"/></filter></defs>
  <path d="M${V.cost} L${V.speed} L${V.env}Z" fill="#f8fdf8"/>
  <g clip-path="url(#triclip)"><rect width="460" height="420" fill="url(#tS)"/><rect width="460" height="420" fill="url(#tC)"/><rect width="460" height="420" fill="url(#tE)"/>${g}</g>
  <path d="M${V.cost} L${V.speed} L${V.env}Z" fill="none" stroke="#7cc99a" stroke-width="3" stroke-linejoin="round"/>
  <text class="vlabel" x="230" y="22" text-anchor="middle">Cost</text><text class="vsub" x="230" y="36" text-anchor="middle">pay less</text>
  <text class="vlabel" x="36" y="398">Speed</text><text class="vsub" x="36" y="412">open sooner</text>
  <text class="vlabel" x="424" y="398" text-anchor="end">Environment</text><text class="vsub" x="424" y="412" text-anchor="end">lower CO2</text>
  <circle id="ghost" class="ghost-dot" r="9" cx="230" cy="250" opacity="0"/><text id="ghostT" class="vsub" opacity="0" font-weight="700" fill="#c0614f">plan lands here</text>
  <g id="leaf" filter="url(#sh)"><path d="M0 -22 C18 -15 20 9 0 25 C-20 9 -18 -15 0 -22Z" fill="url(#leafg)" stroke="#2f7d5b" stroke-width="2"/><path d="M0 -15 L0 22 M0 -2 L9 -10 M0 7 L-9 -1 M0 -9 L-7 -15" stroke="#fff" stroke-opacity=".85" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M0 25 Q2 33 8 36" stroke="#2f7d5b" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>`;
  setLeaf(state.weights);
  let dragging = false;
  const move = ev => {
    const r = svg.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * 460, y = ((ev.clientY - r.top) / r.height) * 420;
    state.weights = bary(x, y); state.pin = null; state.custom = null; setLeaf(state.weights); schedule(90);
  };
  svg.addEventListener('pointerdown', ev => { dragging = true; svg.setPointerCapture(ev.pointerId); $('#leaf').classList.add('drag'); move(ev); });
  svg.addEventListener('pointermove', ev => dragging && move(ev));
  const up = () => { dragging = false; $('#leaf').classList.remove('drag'); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}
function setLeaf(w) {
  const [x, y] = pos(w);
  $('#leaf').setAttribute('transform', `translate(${x} ${y}) rotate(${-35 + w.env * 70 - w.speed * 25}) scale(${0.8 + w.env * 0.45})`);
  $('#wchips').innerHTML = `<span class="chipw s">Speed ${fmt0(w.speed * 100)}%</span><span class="chipw c">Cost ${fmt0(w.cost * 100)}%</span><span class="chipw e">Environment ${fmt0(w.env * 100)}%</span>`;
}
function setGhost(w) {
  const g = $('#ghost'), t = $('#ghostT');
  if (!w) { g.setAttribute('opacity', 0); t.setAttribute('opacity', 0); return; }
  const [x, y] = pos(w), [lx, ly] = pos(state.weights), far = Math.hypot(x - lx, y - ly) > 22;
  g.setAttribute('cx', x); g.setAttribute('cy', y); g.setAttribute('opacity', far ? 1 : 0);
  t.setAttribute('x', x + 13); t.setAttribute('y', y + 4); t.setAttribute('opacity', far ? 1 : 0);
}
function buildPresets() {
  const P = [['Fastest', { speed: 1, cost: 0, env: 0 }], ['Cheapest', { speed: 0, cost: 1, env: 0 }], ['Greenest', { speed: 0, cost: 0, env: 1 }], ['Balanced', { speed: 1 / 3, cost: 1 / 3, env: 1 / 3 }]];
  $('#presets').innerHTML = P.map((p, i) => `<button class="pill" data-i="${i}">${p[0]}</button>`).join('');
  $$('#presets .pill').forEach(b => b.onclick = () => animateTo(P[+b.dataset.i][1]));
}
function animateTo(target) {
  const from = { ...state.weights }, t0 = performance.now();
  state.pin = null; state.custom = null;
  const step = now => {
    const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3);
    state.weights = { speed: from.speed + (target.speed - from.speed) * e, cost: from.cost + (target.cost - from.cost) * e, env: from.env + (target.env - from.env) * e };
    setLeaf(state.weights); if (k < 1) requestAnimationFrame(step); else schedule(10);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ priority limits */
const fmtMetric = (k, v) => ({ full: `month ${fmt0(v)}`, start: `month ${fmt0(v)}`, usd_mwh: `$${fmt(v, 1)}/MWh`, total_musd: `$${fmt0(v)}M`, running_musd: `$${fmt0(v)}M`,
  pct_over: `${fmt0(v)}% over cheapest`, kg: `${fmt0(v)} kg/MWh`, clean: `${fmt0(v)}%`, tonnes: `${fmt0(v / 1000)} kt` }[k]);
const isHigh = k => k === 'clean';
const track = k => META.tracks[k];
const snap = (k, v) => { const s = STEP[k], t = track(k); return Math.min(t.max, Math.max(t.min, Math.round(v / s) * s)); };
function convert(axis, from, to, limit) {
  if (limit == null) return null;
  if (axis === 'speed') return snap(to, to === 'start' ? limit - 10 : limit + 10);
  if (axis === 'cost' && from === 'usd_mwh' && to === 'pct_over') return snap(to, (limit / META.cheapest - 1) * 100);
  if (axis === 'cost' && from === 'pct_over' && to === 'usd_mwh') return snap(to, META.cheapest * (1 + limit / 100));
  return null; // no clean conversion: back to the "any plan" end of the track
}
function buildLimits() {
  const rows = AX.map(a => `<div class="lim-row" id="lim-${a.k}">
    <div class="lim-top"><b title="${a.help}">${a.name}</b><select id="sel-${a.k}">${a.metrics.map(m => `<option value="${m[0]}">${m[1]}</option>`).join('')}</select></div>
    <div class="lim-read"><span id="lo-${a.k}"></span><span id="rd-${a.k}"></span></div>
    <div class="track" id="tr-${a.k}"><div class="base"></div><div class="acc" id="acc-${a.k}"></div><div class="hdl" id="hd-${a.k}"></div><div class="rec" id="rc-${a.k}"></div></div>
    <div class="lim-ends"><span id="mn-${a.k}"></span><span id="mx-${a.k}"></span></div></div>`).join('');
  $('#limits').innerHTML = `<h3>Priority limits</h3><p class="what">Lines the plan must not cross. Drag a handle; everything in the blue range is acceptable.</p>${rows}
    <div class="lim-row"><div class="lim-top"><b title="Tier 2 work can be paused during grid emergencies. Switch on to forbid it.">Work paused</b>
      <label style="display:flex;gap:8px;align-items:center;font-size:.85rem;font-weight:700"><span class="sw"><input type="checkbox" id="never-t2" checked><span></span></span>Never (requirement)</label></div></div>
    <div class="lim-note" id="limNote" hidden>Totals favor later starts because they serve less energy.</div>
    <div class="lim-legend"><span><i class="lg-g"></i>what any plan can reach</span><span><i class="lg-b"></i>your acceptable range</span><span><i class="lg-d"></i>recommended plan</span></div>`;
  for (const a of AX) {
    $(`#sel-${a.k}`).onchange = e => {
      const L = state.limits[a.k], to = e.target.value;
      L.limit = convert(a.k, L.metric, to, L.limit); L.metric = to; state.pin = null; state.custom = null; paintLimits(last); schedule(10);
    };
    const tr = $(`#tr-${a.k}`);
    let drag = false;
    const set = ev => {
      const r = tr.getBoundingClientRect(), k = state.limits[a.k].metric, t = track(k);
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), v = snap(k, t.min + f * (t.max - t.min));
      const high = isHigh(k), atEnd = high ? f < 0.015 : f > 0.985;
      state.limits[a.k].limit = atEnd ? null : v; state.pin = null; state.custom = null; paintLimits(last); schedule(60);
    };
    tr.addEventListener('pointerdown', ev => { drag = true; tr.setPointerCapture(ev.pointerId); set(ev); });
    tr.addEventListener('pointermove', ev => drag && set(ev));
    tr.addEventListener('pointerup', () => drag = false);
  }
  $('#never-t2').onchange = e => { state.limits.never_t2 = e.target.checked; state.pin = null; state.custom = null; schedule(10); };
  paintLimits(null);
}
function paintLimits(res) {
  if (!META) return;
  let totals = false;
  for (const a of AX) {
    const L = state.limits[a.k], k = L.metric, t = track(k), high = isHigh(k);
    $(`#sel-${a.k}`).value = k;
    const pct = v => Math.min(100, Math.max(0, ((v - t.min) / (t.max - t.min)) * 100));
    const at = L.limit == null ? (high ? 0 : 100) : pct(L.limit);
    $(`#hd-${a.k}`).style.left = at + '%';
    const acc = $(`#acc-${a.k}`);
    acc.style.left = high ? at + '%' : '0'; acc.style.width = (high ? 100 - at : at) + '%';
    $(`#mn-${a.k}`).textContent = fmtMetric(k, t.min); $(`#mx-${a.k}`).textContent = fmtMetric(k, t.max);
    $(`#lo-${a.k}`).textContent = L.limit == null ? 'No limit' : `Limit: ${high ? 'at least ' : 'at most '}${fmtMetric(k, L.limit)}`;
    const rc = $(`#rc-${a.k}`), val = res && res.feasible ? res.rec_values[k] : null;
    rc.style.display = val == null ? 'none' : 'block'; if (val != null) { rc.style.left = pct(val) + '%'; rc.title = 'Recommended plan: ' + fmtMetric(k, val); }
    $(`#rd-${a.k}`).innerHTML = val == null ? '' : `Plan: <b>${fmtMetric(k, val)}</b>`;
    if (META.metrics[k].total_based) totals = true;
  }
  $('#limNote').hidden = !totals;
}
function setLimit(axis, metric, limit) {
  state.limits[axis] = { metric, limit }; state.pin = null; state.custom = null; paintLimits(last);
}
const resetLimits = () => { state.limits.speed = { metric: 'full', limit: null }; state.limits.cost = { metric: 'usd_mwh', limit: null }; state.limits.env = { metric: 'kg', limit: null }; state.limits.never_t2 = true; $('#never-t2').checked = true; };

function buildVals() {
  $('#vals').innerHTML = `<div class="valrow"><span class="sw"><input type="checkbox" id="premOn"><span></span></span><span>Willing to pay up to</span><input type="number" id="premPct" value="10" min="0" max="300">
      <span>% more than the cheapest plan with full demand by month</span><input type="number" id="premRef" value="30" min="24" max="60"></div>
    <label class="valrng"><span>Value of opening one month sooner</span><input type="range" id="valMonth" min="0" max="10" step="0.5" value="0"><b id="valMonthV">$0M</b></label>
    <small>These are your own valuations. They steer the choice but never change the official cost.</small>`;
  const upd = () => { state.premium = { on: $('#premOn').checked, pct: +$('#premPct').value || 0, ref: +$('#premRef').value || 30 }; state.pin = null; state.custom = null; schedule(250); };
  ['#premOn', '#premPct', '#premRef'].forEach(s => $(s).oninput = upd);
  $('#valMonth').oninput = e => { state.valueMonth = +e.target.value; $('#valMonthV').textContent = `$${e.target.value}M`; state.pin = null; state.custom = null; schedule(200); };
  $('#hurdle').oninput = e => { state.hurdle = +e.target.value; $('#hurdleV').textContent = `$${state.hurdle}/t`; schedule(200); };
}

/* ------------------------------------------------------------------ solve & render */
let timer, seq = 0;
function schedule(ms = 100) { clearTimeout(timer); timer = setTimeout(solve, ms); }
async function solve() {
  const my = ++seq; $('#busy').innerHTML = '<span class="spin"></span> updating'; $('#resCard').classList.add('loading');
  try {
    const res = await api('/api/solve', { weights: state.weights, limits: state.limits, switches: state.switches, hurdle: state.hurdle, pin: state.pin, custom: state.custom,
      premium: state.premium.on ? { pct: state.premium.pct, ref_month: state.premium.ref } : null, value_month_musd: state.valueMonth });
    if (my !== seq) return;
    last = res; render(res);
  } catch (e) { $('#res').innerHTML = `<p style="color:#b8323f">Something went wrong: ${e.message}</p>`; }
  $('#busy').textContent = ''; $('#resCard').classList.remove('loading');
}
const capPills = caps => Object.entries(caps).filter(([, v]) => v > 0).map(([k, v]) => `<span class="cpill" style="background:${COLORS[k]}55">${ICONS[k]}${NAMES[k]} ${fmt0(v)} MW</span>`).join('');
const KPI = (label, value, sub, help) => `<div class="kpi" title="${help}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;

function render(res) {
  paintLimits(res);
  if (!res.feasible) return renderInfeasible(res);
  const c = res.chosen, d = res.detail, cl = res.climate;
  setGhost(res.implied_cursor);
  $('#whatif').classList.toggle('show', !d.common_model);
  const title = { efficient: 'Good climate value for the money', pivot: 'Suggestion: a greener plan is worth the extra cost', weak: 'Emissions are on the high side' }[cl.verdict];
  const pv = cl.pivot;
  const ladder = cl.ladder.length ? `<div class="ladder"><b>Want a better environmental score? What it would cost:</b>${cl.ladder.map(s => `<div class="lstep"><div>Pay <b>${M(s.pay_musd)} more</b> (${fmt(s.pay_pct, 0)}%) to cut emissions to <b>${fmt0(s.intensity)} kg/MWh</b>, ${fmt0(s.intensity_cut_kg)} lower.<br><small>${fmt0(s.usd_per_tonne)} dollars per tonne of CO2 avoided</small></div><button class="btn ghost small" data-pin="${s.id}">Choose this</button></div>`).join('')}</div>` : '';
  const sentence = `Open in <b>month ${c.start}</b> (full power by month ${c.full_month}). Build ${joinAnd(listNames(c.caps))}. Over ten years it costs about <b>${M(d.total_decision_cost_usd / 1e6)}</b>, causes <b>${fmt0(d.combined_electricity_co2_kg_per_mwh)} kg</b> of CO2 per MWh, and ${fmt0(d.clean_energy_share * 100)}% of the energy is clean.`;
  $('#res').innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <h3 style="font-size:1.25rem;margin:0">${res.info.custom ? res.info.custom.label + ' plan' : 'Recommended plan'} ${res.info.custom ? '<span class="tag user">framework archetype</span>' : state.pin ? '<span class="tag user">chosen by you</span>' : ''}${d.common_model ? '<span class="tag auto" title="Same as what the official checker verifies">official model</span>' : '<span class="tag" style="background:var(--butter)">what-if</span>'}</h3>
      <small>${res.survivors} of ${res.info.candidates_checked} plans meet your limits</small></div>
    <p class="summary">${sentence}</p>
    ${res.info.custom && !res.info.custom.meets_limits ? '<p class="muted" style="margin:6px 0 0">This archetype plan lies outside your current Priority limits; it is shown because you loaded it.</p>' : ''}
    <div class="caps-line">${capPills(c.caps)}</div>
    ${res.info.premium ? `<p class="muted" style="margin:8px 0 0">Your willingness to pay: ${res.info.premium.pct}% above the cheapest plan (${M(res.info.premium.ref_cost_musd)}) gives a ceiling of ${M(res.info.premium.cap_musd)}.</p>` : ''}
    <div class="kpis" style="margin-top:12px">
      ${KPI('Opens in', 'Month ' + c.start, `full power month ${c.full_month}`, 'Initial service: the first month the data center runs, at one-third load. Full demand comes 10 months later.')}
      ${KPI('Ten-year cost', M(d.total_decision_cost_usd / 1e6), `${fmt(d.decision_cost_usd_per_requested_mwh, 1)} $ per MWh`, 'Equipment charges, contracts, fuel, market power, and penalties for moved or paused work, over 120 months.')}
      ${KPI('Emissions', fmt0(d.combined_electricity_co2_kg_per_mwh) + ' kg/MWh', 'CO2 per unit of energy', 'Kilograms of CO2 per MWh of electricity used. Lower is cleaner.')}
      ${KPI('Clean energy', fmt(d.clean_energy_share * 100, 0) + '%', 'wind, solar, nuclear', 'Share of campus energy from wind, solar and nuclear contracts, after battery losses.')}
      ${KPI('Bought on the market', fmt(d.merchant_share * 100, 0) + '%', `${fmt0(d.merchant_mwh / 1000)} GWh`, 'Power bought hourly from the open market at the market price plus a fee.')}
      ${KPI('Work moved elsewhere', fmt0(d.relocated_local_equivalent_mwh) + ' MWh', M(d.relocation_cost_usd / 1e6) + ' fee', 'Tier 1 work moved to another site during grid emergencies.')}
      ${KPI('Work paused', fmt0(d.interrupted_mwh) + ' MWh', M(d.interruption_consequence_usd / 1e6) + ' penalty', 'Tier 2 work paused during grid emergencies.')}
      ${KPI('Power not delivered', fmt(d.unmet_mwh, 0) + ' MWh', 'essential work is never cut', 'Demand that could not be powered at all. A valid plan has none.')}
    </div>
    <div class="verdict ${cl.verdict}"><div style="flex:1"><b style="font-size:1.05rem">${title}</b>
      <div class="muted">${cl.band}. Your climate hurdle is $${cl.hurdle} per tonne.</div>
      ${cl.reasons.map(r => `<p>${r}</p>`).join('')}
      ${pv ? `<div class="caps-line">${capPills(pv.caps)}</div><p><b>Suggested plan:</b> open in month ${pv.start}${pv.delta_months ? ` (${pv.delta_months > 0 ? '+' : ''}${pv.delta_months} months)` : ''}, ${pv.delta_cost_per_mwh >= 0 ? '+' : ''}${fmt(pv.delta_cost_per_mwh, 2)} $ per MWh, ${fmt0(pv.intensity)} kg/MWh (${fmt0(pv.co2_cut_pct)}% lower), ${fmt0(pv.clean * 100)}% clean.</p><button class="btn warn small" data-pin="${pv.row_id}">Switch to the suggested plan</button>` : ''}
      ${cl.verdict === 'efficient' && !cl.ladder.length ? '<p class="muted">No cheaper-per-tonne improvement exists for this opening month.</p>' : ''}
      ${ladder}</div></div>
    <h3 style="margin-top:16px">Why this plan</h3><ul class="why">${res.explain.map(x => `<li>${x}</li>`).join('')}</ul>
    ${res.alternatives.length ? `<details style="margin-top:10px"><summary><b>Other close plans</b></summary><table class="t"><tr><th>Opens</th><th>What is built (MW)</th><th>$/MWh</th><th>kg/MWh</th><th></th></tr>${res.alternatives.map(a => `<tr><td>Month ${a.start}</td><td>${Object.entries(a.caps).filter(([, v]) => v).map(([k, v]) => `${ICONS[k]}${fmt0(v)}`).join(' ')}</td><td>${fmt(a.cost_per_mwh, 1)}</td><td>${fmt0(a.intensity)}</td><td><button class="btn ghost small" data-pin="${a.id}">Use</button></td></tr>`).join('')}</table></details>` : ''}`;
  $$('#res [data-pin]').forEach(b => b.onclick = () => { state.pin = b.dataset.pin; solve(); });
  $('#donut').innerHTML = donut(d.mix_mwh, d.clean_energy_share, d.local_served_mwh);
  $('#donutTip').innerHTML = tip(mixTip(d));
  $('#capbars').innerHTML = capacityBars(d.capacity_rows, META.land_limit);
  $('#capTip').innerHTML = tip(capTip(d));
  $('#annual').innerHTML = annualChart(d.annual) + `<details><summary><b>Show the numbers</b></summary><table class="t"><tr><th>Year</th><th>Energy served (GWh)</th><th>Cost ($M)</th><th>$ per MWh</th><th>kg per MWh</th><th>Clean</th></tr>${d.annual.map(y => `<tr><td>${y.model_year}</td><td>${fmt0(y.served_mwh / 1000)}</td><td>${fmt(y.cost_usd / 1e6, 1)}</td><td>${fmt(y.cost_per_requested_mwh, 1)}</td><td>${fmt0(y.co2_kg_per_mwh)}</td><td>${fmt0((y.clean_share || 0) * 100)}%</td></tr>`).join('')}</table></details>`;
  $('#annualTip').innerHTML = tip(annualTip(d));
  renderAddOne(d);
  $('#waiting').innerHTML = waitingCurve(LIBPTS.points, LIBPTS.months, { start: c.start });
  $('#waitTip').innerHTML = tip(waitTip(c));
  renderPeriods(d); renderLedger(d); renderExt(d); renderExport(res);
  clearTimeout(scnTimer); scnTimer = setTimeout(() => { loadScenarios(); loadContinuity(); }, 300);
}

function renderInfeasible(res) {
  setGhost(null);
  const nm = { speed: 'the opening limit', cost: 'the cost limit', env: 'the environment limit', uptime: 'the no-paused-work rule' };
  const opts = res.relaxations.map(o => {
    const what = o.axis === 'uptime' ? 'Allow some Tier 2 work to be paused' : `Relax ${nm[o.axis]} to ${fmtMetric(o.metric, o.value)}`;
    return `<div class="lstep"><div><b>${what}</b><br><small>Gives a plan that opens in month ${o.start}.</small></div><button class="btn ghost small" data-ax="${o.axis}" data-m="${o.metric}" data-v="${o.value ?? ''}">Apply</button></div>`;
  }).join('');
  const n = res.nearest;
  $('#res').innerHTML = `<h3 style="font-size:1.25rem">No plan meets all your limits together</h3>
    <p class="summary">${res.message}</p>
    ${opts ? `<div class="relax">${opts}</div>` : '<p class="muted">Loosen two limits at once; no single change is enough.</p>'}
    ${n ? `<p style="margin-top:12px">Closest plan found opens in month ${n.start}.</p><button class="btn warn small" id="nearBtn">Show the closest plan</button>` : ''}
    <p class="muted" style="margin-top:10px">This reflects a library of ${res.info.library_portfolios} ready-made plans, so it is not proof that nothing could work.</p>`;
  $$('#res [data-ax]').forEach(b => b.onclick = () => {
    if (b.dataset.ax === 'uptime') { state.limits.never_t2 = false; $('#never-t2').checked = false; }
    else setLimit(b.dataset.ax, b.dataset.m, snapUp(b.dataset.m, +b.dataset.v));
    solve();
  });
  const nb = $('#nearBtn'); if (nb) nb.onclick = () => { state.pin = n.row_id; solve(); };
}
const snapUp = (k, v) => isHigh(k) ? Math.floor(v / STEP[k]) * STEP[k] : Math.ceil(v / STEP[k] - 1e-9) * STEP[k];

function renderAddOne(d) {
  const hurdle = state.hurdle;
  const rows = d.add_one.map(r => {
    const nm = `${NAMES[r.id]} (+${r.step} MW)`;
    if (r.blocked) return `<tr><td>${nm}</td><td colspan="5" class="muted">Not possible: at its maximum or the 8-acre site is full.</td></tr>`;
    const cut = -r.d_kg, perT = r.usd_per_tonne;
    let verdict;
    if (r.d_cost_musd < -0.05) verdict = '<b class="good">Would save money</b>';
    else if (perT == null || cut < 0.05) verdict = '<span class="muted">Adds cost, no emissions benefit</span>';
    else verdict = perT <= hurdle ? `<b class="good">Worth it: ${fmt0(perT)} $/t is under your $${hurdle}/t</b>` : `<b class="bad">Not worth it: ${fmt0(perT)} $/t is above your $${hurdle}/t</b>`;
    return `<tr><td>${ICONS[r.id]}${nm}${r.in_plan ? ' <small class="muted">(already in plan)</small>' : ''}</td><td>${r.d_cost_musd >= 0 ? '+' : ''}${M(r.d_cost_musd)}</td><td>${r.d_kg >= 0 ? '+' : ''}${fmt(r.d_kg, 1)} kg/MWh</td><td>${r.d_clean_pts >= 0 ? '+' : ''}${fmt(r.d_clean_pts, 1)} pts</td><td>${perT == null ? '-' : fmt0(perT)}</td><td>${verdict}</td></tr>`;
  }).join('');
  $('#addOne').innerHTML = `<table class="t addt"><tr><th>If you add</th><th>Ten-year cost</th><th>Emissions</th><th>Clean share</th><th>$ per tonne CO2 avoided</th><th>Verdict at your climate hurdle</th></tr>${rows}</table>`;
  const missing = d.add_one.filter(r => !r.in_plan && !r.blocked && r.id !== 'wind' && r.id !== 'utility_solar');
  const pick = ['nuclear', 'battery_4h'].map(k => d.add_one.find(r => r.id === k)).filter(r => r && !r.in_plan && !r.blocked && r.usd_per_tonne != null);
  $('#addTip').innerHTML = tip(pick.length
    ? pick.map(r => `${NAMES[r.id]} is left out because adding ${r.step} MW would cost ${M(r.d_cost_musd)} more for only ${fmt(Math.abs(r.d_kg), 1)} kg/MWh less CO2 (${fmt0(r.usd_per_tonne)} $ per tonne).`).join(' ') + ' Raise the climate hurdle or move the marker toward Environment and they appear.'
    : 'Every source that is not in the plan was tested and either costs more than it saves or is not allowed here.');
}

/* ------------------------------------------------------------------ one-line takeaways */
function mixTip(d) {
  const m = d.mix_mwh, tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const other = (m.merchant + m.gas_turbine + m.gas_engine + m.fuel_cell) / tot;
  return `${fmt0(d.clean_energy_share * 100)}% of your energy is clean, and the biggest source is ${NAMES[top[0]].toLowerCase()} at ${fmt0(top[1] / tot * 100)}%. ${other > 0.2 ? 'Gas and market power still supply a fifth or more; move the marker toward Environment to reduce that.' : 'Gas and market power supply only ' + fmt0(other * 100) + '%.'}`;
}
function capTip(d) {
  const used = d.land_acres, free = META.land_limit - used;
  return `The plan uses ${fmt(used, 1)} of 8 acres. ${free > 1 ? `About ${fmt(free, 1)} acres are free if you later want more storage or backup.` : 'The site is nearly full, so any extra onsite equipment would need a larger site.'}`;
}
function annualTip(d) {
  const a = d.annual, full = a[a.length - 1], first = a.find(y => y.served_mwh > 0) || full;
  const early = first.requested_mwh < 0.5 * full.requested_mwh;
  return `${early ? `Year ${first.model_year} costs less only because the campus is still ramping up. ` : ''}Emissions per MWh go from ${fmt0(first.co2_kg_per_mwh)} kg in year ${first.model_year}, the first year with demand, to ${fmt0(full.co2_kg_per_mwh)} kg in year 10${full.co2_kg_per_mwh < first.co2_kg_per_mwh ? ' as the grid gets cleaner and your contracts start up' : ''}; yearly cost settles near ${M(full.cost_usd / 1e6)}.`;
}
function waitTip(c) {
  const ms = LIBPTS.months.filter(m => m <= 42), best = {};
  for (const p of LIBPTS.points) if (p.start <= 42 && (!(p.start in best) || p.cost < best[p.start])) best[p.start] = p.cost;
  const cheapM = ms.reduce((a, b) => best[b] < best[a] ? b : a, ms[0]);
  const diff = c.cost_per_mwh - best[cheapM];
  return cheapM === c.start || Math.abs(diff) < 0.3 ? `Your opening month is already close to the cheapest option, so waiting would not save much.`
    : `The cheapest opening is month ${cheapM}, at ${fmt(best[cheapM], 1)} $ per MWh. Opening in month ${c.start} costs about ${fmt(Math.abs(diff), 1)} $ per MWh ${diff > 0 ? 'more' : 'less'} but gets power ${Math.abs(cheapM - c.start)} month${Math.abs(cheapM - c.start) === 1 ? '' : 's'} ${cheapM > c.start ? 'sooner' : 'later'}.`;
}
function traceTip(ev) {
  if (!ev.enforced) return 'This window is switched off, so the campus can draw its full connection and nothing is moved or paused.';
  if (ev.unmet_mwh > 0.5) return `Warning: ${fmt0(ev.unmet_mwh)} MWh could not be powered in this window over ten years. Add gas or a battery, or allow more work to move.`;
  const bits = [];
  if (ev.onsite_gas_mwh > 0.5) bits.push(`onsite gas supplied ${fmt0(ev.onsite_gas_mwh)} MWh`);
  if (ev.battery_mwh > 0.5) bits.push(`the battery supplied ${fmt0(ev.battery_mwh)} MWh`);
  const cut = ev.relocated_mwh + ev.interrupted_mwh;
  return `${bits.length ? 'To stay under the import limit, ' + bits.join(' and ') + '. ' : ''}${cut > 0.5 ? `${fmt0(ev.relocated_mwh)} MWh of work was moved and ${fmt0(ev.interrupted_mwh)} MWh paused.` : 'No work had to be moved or paused.'}`;
}
function stressTip(d) {
  const T = k => d.events.reduce((s, e) => s + e[k], 0), tot = T('relocated_mwh') + T('interrupted_mwh');
  return T('unmet_mwh') > 0.5 ? `Some demand goes unpowered in these windows. Add onsite gas or storage.` :
    tot < 1 ? 'The plan rides through all emergencies on its own equipment, with no work moved or paused.' :
    `Across all emergencies the plan moves ${fmt0(T('relocated_mwh'))} MWh and pauses ${fmt0(T('interrupted_mwh'))} MWh, a tiny part of the total energy used.`;
}
function demoTip(rows) {
  const s = rows.find(r => r.key === 'speed_first'), g = rows.find(r => r.key === 'climate_first');
  return `Moving from Balanced to Speed opens ${Math.abs(s.vs_balanced.months)} month${Math.abs(s.vs_balanced.months) === 1 ? '' : 's'} ${s.vs_balanced.months <= 0 ? 'sooner' : 'later'} for ${fmt(s.vs_balanced.cost_per_mwh, 1)} $ per MWh more. Moving to Climate cuts emissions by ${fmt0(Math.abs(g.vs_balanced.intensity))} kg/MWh at ${g.vs_balanced.cost_per_mwh >= 0 ? '+' : ''}${fmt(g.vs_balanced.cost_per_mwh, 1)} $ per MWh.`;
}

/* ------------------------------------------------------------------ grid emergencies */
function renderPeriods(d) {
  const off = new Set(state.switches.events_off), allOn = off.size === 0, sw = state.switches;
  $('#globalSw').innerHTML = `
    <label title="Turn all seven grid emergencies on or off"><span class="sw"><input type="checkbox" id="swAll" ${allOn ? 'checked' : ''}><span></span></span> All emergencies apply</label>
    <label title="Allow some work to move to another site during emergencies"><span class="sw"><input type="checkbox" id="swT1" ${sw.allow_t1 ? 'checked' : ''}><span></span></span> Allow moving work</label>
    <label title="Allow some work to be paused during emergencies. Off means no work is ever paused."><span class="sw"><input type="checkbox" id="swT2" ${sw.allow_t2 ? 'checked' : ''}><span></span></span> Allow pausing work</label>
    <div class="stepper" title="Delay every grid upgrade by this many months"><button id="dm">-</button><b id="dv">${sw.delay === 0 ? 'Grid on time' : sw.delay + ' months late'}</b><button id="dp">+</button></div>`;
  $('#swAll').onchange = e => { state.switches.events_off = e.target.checked ? [] : META.events.map(x => x.index); state.pin = null; state.custom = null; solve(); };
  $('#swT1').onchange = e => { state.switches.allow_t1 = e.target.checked; state.pin = null; state.custom = null; solve(); };
  $('#swT2').onchange = e => { state.switches.allow_t2 = e.target.checked; state.pin = null; state.custom = null; solve(); };
  $('#dm').onclick = () => { state.switches.delay = Math.max(0, sw.delay - 1); state.pin = null; state.custom = null; solve(); };
  $('#dp').onclick = () => { state.switches.delay = Math.min(12, sw.delay + 1); state.pin = null; state.custom = null; solve(); };
  $('#plist').innerHTML = d.events.map(ev => `<div class="prow ${ev.enforced ? '' : 'off'} ${ev.index === selEvent ? 'sel' : ''}" data-i="${ev.index}">
    <label class="sw" onclick="event.stopPropagation()"><input type="checkbox" data-ev="${ev.index}" ${ev.enforced ? 'checked' : ''}><span></span></label>
    <div class="nm"><b>${ev.label}, ${ev.hours_per_year} hours</b><small>${ev.window}. Grid limited to ${fmt0(ev.import_fraction * 100)}%${ev.enforced ? '' : ' (switched off)'}</small></div>
    <div class="resp"><span class="rchip" style="background:#c9b6ec66" title="Work moved to another site">moved ${fmt0(ev.relocated_mwh)}</span><span class="rchip" style="background:#f0a0a866" title="Work paused">paused ${fmt0(ev.interrupted_mwh)}</span>
      <span class="rchip" style="background:#f5a65b55" title="Energy from onsite gas">gas ${fmt0(ev.onsite_gas_mwh)}</span><span class="rchip" style="background:#3fbf8f55" title="Energy from the battery">battery ${fmt0(ev.battery_mwh)}</span></div></div>`).join('');
  $$('#plist input[data-ev]').forEach(inp => inp.onchange = e => {
    const i = +inp.dataset.ev, s = new Set(state.switches.events_off); e.target.checked ? s.delete(i) : s.add(i);
    state.switches.events_off = [...s]; state.pin = null; state.custom = null; selEvent = i; solve();
  });
  $$('#plist .prow').forEach(r => r.onclick = () => { selEvent = +r.dataset.i; renderPeriods(last.detail); });
  $('#trace').innerHTML = eventTrace(d.events[selEvent]);
  $('#traceTip').innerHTML = tip(traceTip(d.events[selEvent]));
  const T = k => d.events.reduce((s, e) => s + e[k], 0);
  $('#stressTotals').innerHTML = `<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${KPI('Work moved', fmt0(T('relocated_mwh')) + ' MWh', 'all emergencies, 10 years', 'Tier 1 work moved to another site.')}${KPI('Work paused', fmt0(T('interrupted_mwh')) + ' MWh', 'all emergencies, 10 years', 'Tier 2 work paused.')}${KPI('Not delivered', fmt(T('unmet_mwh'), 1) + ' MWh', 'should be zero', 'Demand that could not be powered.')}</div>${tip(stressTip(d))}`;
}

/* ------------------------------------------------------------------ continuity during grid stress */
let contSeq = 0;
async function loadContinuity() {
  if (!last || !last.feasible) return;
  const my = ++contSeq, c = last.chosen;
  $('#contCard').classList.add('loading');
  try {
    const r = await api('/api/continuity', { caps: c.caps, start: c.start, lam: c.lam, switches: state.switches });
    if (my === contSeq) renderContinuity(r);
  } catch (e) { $('#contCard').innerHTML = `<p class="muted">Continuity check failed: ${e.message}</p>`; }
  $('#contCard').classList.remove('loading');
}
function renderContinuity(r) {
  const L = r.live, D2 = r.deep;
  const yes = (ok, txt) => ok ? `<b style="color:#2e6b52">Yes</b>${txt ? ' <small>' + txt + '</small>' : ''}` : `<b style="color:#b8323f">No</b>${txt ? ' <small>' + txt + '</small>' : ''}`;
  const addTxt = a => Object.keys(a).length ? Object.entries(a).map(([k, v]) => `+${fmt0(v)} MW ${NAMES[k].toLowerCase()}`).join(', ') : 'none needed';
  const col = (x, extra) => { const p = x.proof; return {
    cost: M(x.cost_musd), extra, paused: fmt0(p.interrupted_mwh) + ' MWh', moved: `${fmt0(p.relocated_mwh)} MWh <small>(peak ${fmt0(p.relocation_limit_used_pct)}% of the 11.4 MW limit)</small>`,
    limit: yes(p.max_import_over_limit_mw <= 1e-6, `all ${fmt0(p.stress_hours)} stress hours, tightest headroom ${fmt(Math.max(0, p.min_import_headroom_mw), 2)} MW`),
    t0: yes(p.tier0_min_margin_mw >= -1e-6 && p.unserved_mwh < 1e-3, 'every hour'), gas: fmt0(p.onsite_gas_in_events_mwh) + ' MWh', batt: fmt0(p.battery_in_events_mwh) + ' MWh', kg: fmt0(x.intensity) + ' kg/MWh' }; };
  const z = L.zero_t2, zz = L.zero_t2_no_reloc;
  const a = col(z, z.extra_cost_musd > 0.005 ? `+${M(z.extra_cost_musd)} (${fmt(z.extra_per_mwh, 2)} $/MWh)` : '$0, no change'),
        b = col(zz, zz.extra_cost_musd > 0.005 ? `+${M(zz.extra_cost_musd)} (${fmt(zz.extra_per_mwh, 2)} $/MWh)` : '$0, no change');
  const rows = [['Ten-year cost', 'cost'], ['Extra cost to guarantee it', 'extra'], ['Tier 2 work paused', 'paused'], ['Tier 1 work moved (within limit)', 'moved'],
    ['Reduced import limit met', 'limit'], ['Tier 0 served on site', 't0'], ['Onsite gas used in emergencies', 'gas'], ['Battery used in emergencies', 'batt'], ['Emissions', 'kg']];
  let deepHtml = '';
  if (D2) {
    const f = D2.flex, zt = D2.zero_t2, zn = D2.zero_t2_no_reloc, caps = o => Object.entries(o).map(([k, v]) => `${ICONS[k]}${fmt0(v)}`).join(' ');
    deepHtml = `<h3 style="margin-top:18px">Best plan found for opening in month ${r.start} (fully re-optimized)</h3>
      <table class="t"><tr><th></th><th>Pausing allowed</th><th>No Tier 2 pauses</th><th>No pauses, no relocation</th></tr>
      <tr><td>What is built (MW)</td><td>${caps(f.caps)}</td><td>${caps(zt.caps)}</td><td>${caps(zn.caps)}</td></tr>
      <tr><td>Ten-year cost</td><td>${M(f.cost_musd)}</td><td>${M(zt.cost_musd)} <small>(${zt.cost_musd - f.cost_musd >= 0 ? '+' : ''}${M(zt.cost_musd - f.cost_musd)})</small></td><td>${M(zn.cost_musd)} <small>(${zn.cost_musd - f.cost_musd >= 0 ? '+' : ''}${M(zn.cost_musd - f.cost_musd)})</small></td></tr>
      <tr><td>Tier 2 paused / Tier 1 moved</td><td>${fmt0(f.proof.interrupted_mwh)} / ${fmt0(f.proof.relocated_mwh)} MWh</td><td>${fmt0(zt.proof.interrupted_mwh)} / ${fmt0(zt.proof.relocated_mwh)} MWh</td><td>${fmt0(zn.proof.interrupted_mwh)} / ${fmt0(zn.proof.relocated_mwh)} MWh</td></tr>
      <tr><td>Reduced import limit met</td><td>${yes(f.proof.max_import_over_limit_mw <= 1e-6)}</td><td>${yes(zt.proof.max_import_over_limit_mw <= 1e-6)}</td><td>${yes(zn.proof.max_import_over_limit_mw <= 1e-6)}</td></tr></table>`;
  }
  const need = z.extra_cost_musd > 0.005;
  $('#contCard').innerHTML = `<h3>Continuity during grid stress</h3>
    <p class="what">"Meet the reduced grid-import limits during stress events without interrupting any Tier 2 demand. You may relocate Tier 1 within its limits; Tier 0 must stay served locally. What additional resources or cost does that require?"</p>
    <table class="t"><tr><th>For the plan on screen</th><th>No Tier 2 pauses (the requirement)</th><th>Also no relocation (stricter test)</th></tr>
      <tr><td>Extra equipment needed</td><td>${addTxt(z.adds)}</td><td>${addTxt(zz.adds)}</td></tr>
      ${rows.map(([lab, k]) => `<tr><td>${lab}</td><td>${a[k]}</td><td>${b[k]}</td></tr>`).join('')}</table>
    ${deepHtml}
    ${tip(need ? `Guaranteeing no paused work needs ${addTxt(z.adds)}, about ${M(z.extra_cost_musd)} more over ten years. Tier 1 relocation stays within its limit and Tier 0 is always served on site.`
      : `This plan already meets the requirement: no Tier 2 work is paused, the reduced import limit holds in every stress hour, and Tier 0 is always served on site, so it needs no extra equipment or cost. ${zz.extra_cost_musd > 0.005 ? `Without relocation as well, it would need ${addTxt(zz.adds)} (${M(zz.extra_cost_musd)}).` : 'It even copes without relocating any work.'}`)}`;
}

/* ------------------------------------------------------------------ what-if scenarios */
async function loadScenarios() {
  if (!last || !last.feasible) return;
  const my = ++scnSeq, c = last.chosen;
  $('#scnBody').classList.add('loading');
  try {
    const r = await api('/api/scenarios', { caps: c.caps, start: c.start, lam: c.lam, switches: state.switches });
    if (my !== scnSeq) return; renderScenarios(r, c);
  } catch (e) { $('#scnBody').innerHTML = `<div class="card">Could not run scenarios: ${e.message}</div>`; }
  $('#scnBody').classList.remove('loading');
}
function guard(suite, hardened) {
  const keys = ['best', 'baseline', 'worst'], tot = keys.reduce((s, k) => s + suite[k].unmet_mwh, 0);
  if (tot <= 1e-3) return `<div class="guard ok"><div class="tick">&#10003;</div><div><b class="t">Every hour is powered${hardened ? ' after the fix' : ''}</b><p>No demand goes unpowered in the good year, the official data or the bad year (0.0000 MWh), checked hour by hour.</p></div></div>`;
  const bad = keys.filter(k => suite[k].unmet_mwh > 1e-3).map(k => `${suite[k].label}: ${fmt0(suite[k].unmet_mwh)} MWh over ${fmt0(suite[k].unmet_hours)} hours`).join('; ');
  return `<div class="guard bad"><div class="tick">!</div><div style="flex:1"><b class="t">Some demand would go unpowered in a bad year</b><p>${bad}. The plan works in the official case but has no spare capacity for these shocks.</p>${hardened ? '' : '<button class="btn warn small" id="hardenBtn">Find the cheapest fix</button><span id="hardenOut"></span>'}</div></div>`;
}
function scnTip(S, hardened) {
  const worst = S.worst, base = S.baseline, extra = 100 * (worst.total_adj_musd / base.total_adj_musd - 1);
  if (worst.unmet_mwh > 1e-3) return `The bad year costs ${fmt(extra, 0)}% more once unpowered demand is counted, and leaves ${fmt0(worst.unmet_mwh)} MWh without power. Adding onsite gas is the usual fix; use the button below to price it.`;
  return `Even the bad year is fully powered and costs about ${fmt(Math.max(extra, 0), 0)}% more than the official case${hardened ? ', thanks to the added gas capacity' : ''}.`;
}
function renderScenarios(r, c, hardened) {
  const S = r.suite, order = ['best', 'baseline', 'worst'], col = { best: '#5fb98a', baseline: '#6aa8e0', worst: '#e0626f' };
  const name = { best: 'Good year', baseline: 'Official data', worst: 'Bad year' };
  const cards = order.map(k => { const s = S[k]; return `<div class="scard ${k}"><h3>${name[k]}<span class="muted" style="font-size:.78rem;font-weight:600">${s.delay ? s.delay + ' months late' : 'grid on time'}</span></h3>
    <div class="big">${fmt(s.levelized_adj, 1)} <small>$ per MWh${s.unserved_penalty_musd > 0.005 ? ' incl. unpowered' : ''}</small></div><small>${s.story}</small>
    <ul><li><span>Ten-year cost</span><b>${M(s.total_cost_musd)}</b></li><li><span>Gas price</span><b>$${fmt(s.gas_price_start, 2)}/MMBtu</b></li><li><span>Emissions</span><b>${fmt0(s.intensity)} kg/MWh</b></li><li><span>Clean energy</span><b>${fmt0(s.clean * 100)}%</b></li><li><span>Not delivered</span><b style="color:${s.unmet_mwh > 1e-3 ? '#b8323f' : '#2f7d5b'}">${fmt(s.unmet_mwh, s.unmet_mwh > 1e-3 ? 0 : 1)} MWh</b></li></ul></div>`; }).join('');
  const anyPen = order.some(k => S[k].unserved_penalty_musd > 0.005);
  const g1 = barGroups([{ label: 'Cost per MWh', bars: order.map(k => ({ v: S[k].levelized_adj, color: col[k], name: name[k] })) }], null, { unit: ' $/MWh', title: 'Cost per MWh' + (anyPen ? ' incl. unpowered demand' : '') });
  const g2 = barGroups([{ label: 'Ten-year cost', bars: order.map(k => ({ v: S[k].total_adj_musd, color: col[k], name: name[k] })) }], null, { unit: ' $M', title: 'Ten-year cost ($M)' });
  const pts = r.curve.points, safe = pts.filter(p => p.zone === 'safe').slice(-1)[0], firstBad = pts.find(p => p.zone === 'stress');
  const dtip = firstBad ? `The plan stays fine for a delay of up to ${safe ? safe.delay : 0} month${safe && safe.delay === 1 ? '' : 's'}; beyond that, ${firstBad.unmet_mwh > 1e-3 ? 'some demand goes unpowered' : 'cost rises sharply'}. If your grid date is uncertain, add firm gas.` : 'The plan absorbs a grid delay of up to 12 months without trouble.';
  $('#scnBody').innerHTML = `<div class="scn">${cards}</div>${tip(scnTip(S, hardened))}
    <div class="grid2" style="margin-top:16px"><div class="card">${g1}</div><div class="card">${g2}</div></div>
    <div class="card" style="margin-top:18px"><h3>If the grid connection is late</h3><p class="what">Same plan, grid upgrades delayed by 0 to 12 months.</p>${delayCurve(pts)}
      <div class="zonekey"><span><i style="background:#d9f2e0"></i>Safe</span><span><i style="background:#fff1c6"></i>Manageable</span><span><i style="background:#fbd6d6"></i>High stress</span></div>
      <p class="muted" style="font-size:.82rem">${r.curve.rule}</p>${tip(dtip)}</div>
    <div id="guardBox">${guard(S, hardened)}</div>`;
  const hb = $('#hardenBtn');
  if (hb) hb.onclick = async () => {
    hb.disabled = true; hb.innerHTML = '<span class="spin"></span> searching';
    const h = await api('/api/harden', { caps: c.caps, start: c.start, lam: c.lam, switches: state.switches });
    const adds = Object.entries(h.result.adds).map(([k, v]) => `${fmt0(v)} MW more ${NAMES[k].toLowerCase()}`).join(', ');
    $('#guardBox').innerHTML = guard(h.suite, true) + `<div class="card" style="margin-top:12px"><b>Cheapest fix found:</b> add ${adds || 'nothing'} for about ${M(h.result.extra_cost_musd ?? 0)} extra per scenario. ${h.result.ok ? '' : 'Site or catalog limits prevent a complete fix.'}</div>`;
  };
}

/* ------------------------------------------------------------------ common questions */
function renderQuestions() {
  const q = QS, caps = o => joinAnd(Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${fmt0(v)} MW ${NAMES[k].toLowerCase()}`));
  const go = fn => () => { state.pin = null; state.custom = null; fn(); showTab('studio'); solve(); };
  const cards = [
    ['1', 'Can we reach full demand sooner?', `Reaching full demand by <b>month 24</b> (open month ${q.q1.fast.start}) costs <b>${M(q.q1.extra_cost_musd)} more</b> (${fmt0(q.q1.extra_pct)}% more) than month 30. There is no grid before month 18, so ${caps(Object.fromEntries(Object.entries(q.q1.fast.caps).filter(([k]) => [...OWN, 'battery_4h'].includes(k))))} must carry the campus alone at first.`,
      () => { resetLimits(); setLimit('speed', 'full', 24); animateTo({ speed: 1, cost: 0, env: 0 }); }, 'Set up this question'],
    ['2', 'What is the cheapest plan?', `If full demand can wait until month 36, the lowest cost is <b>${fmt(q.q2.levelized.cost_per_mwh, 1)} $ per MWh</b>, opening in month ${q.q2.levelized.start}. It emits ${fmt0(q.q2.levelized.intensity)} kg/MWh and buys ${fmt0(q.q2.levelized.merchant * 100)}% of its energy on the market.`,
      () => { resetLimits(); setLimit('speed', 'full', 36); animateTo({ speed: 0, cost: 1, env: 0 }); }, 'Set up this question'],
    ['3', 'How soon can we get under 100 kg of CO2 per MWh?', q.q3.answer ? `The earliest is <b>full demand in month ${q.q3.answer.full_month}</b> (open month ${q.q3.answer.start}), at ${fmt(q.q3.answer.cost_per_mwh, 1)} $ per MWh and ${fmt0(q.q3.answer.intensity)} kg/MWh.` : 'No searched plan gets under 100 kg.',
      () => { resetLimits(); setLimit('env', 'kg', 100); animateTo({ speed: 1, cost: 0, env: 0 }); }, 'Set up this question'],
    ['4', 'Can we avoid pausing any work?', `Yes. The lowest-cost plan changes by <b>${q.q4.extra_cost_musd >= 0 ? '+' : ''}${M(q.q4.extra_cost_musd)}</b>. ${Object.keys(q.q4.added).length ? 'It adds ' + Object.entries(q.q4.added).map(([k, v]) => `${fmt0(v)} MW ${NAMES[k].toLowerCase()}`).join(', ') + '.' : 'No extra equipment is needed because onsite gas, the battery and moving work already cover every emergency.'}`,
      () => { state.limits.never_t2 = true; $('#never-t2').checked = true; state.switches.allow_t2 = false; setTimeout(() => showTab('stress'), 400); }, 'See the full answer'],
    ['5', 'What if the grid connection slips 6 months?', `Keeping a month-24 opening costs <b>${M(q.q5.keep24.total_cost_musd)}</b>; opening in month 30 instead costs <b>${M(q.q5.open30.total_cost_musd)}</b>. Adapting costs ${M(Math.abs(q.q5.adapt_extra_musd))} ${q.q5.adapt_extra_musd >= 0 ? 'more' : 'less'} but delivers more energy (${fmt(q.q5.keep24.per_mwh, 1)} versus ${fmt(q.q5.open30.per_mwh, 1)} $ per MWh).`,
      () => { resetLimits(); state.switches.delay = 6; setLimit('speed', 'full', 34); }, 'Set up this question'],
    ['6', 'What if we pay up to 10% more to be faster?', `A 10% premium (ceiling ${M(q.q6.premium_cap_musd)}) ${q.q6.month24_feasible_within_10pct ? 'does' : '<b>does not</b>'} reach full demand at month 24, which needs <b>${fmt0(q.q6.month24_needs_pct)}% more</b>. ${q.q6.best_within_months ? `The earliest it can buy is <b>month ${q.q6.best_within_months.full_month}</b>, at ${fmt(q.q6.best_within.cost_per_mwh, 1)} $ per MWh and ${fmt0(q.q6.best_within.intensity)} kg/MWh.` : ''}`,
      () => { resetLimits(); state.premium = { on: true, pct: 10, ref: 30 }; $('#premOn').checked = true; animateTo({ speed: .6, cost: .2, env: .2 }); }, 'Set up this question'],
    ['7', 'Does buying capacity in stages help?', `Staging part of the capacity (extra MW at month ${[...new Set(Object.values(q.q7.stage).map(s => s.month))].join(' and ') || '-'}) saves <b>${M(q.q7.saving_musd)}</b> versus buying it all upfront (${M(q.q7.upfront_musd)} to ${M(q.q7.staged_musd)}). Charges still run to month 120 once capacity is added.`,
      () => { }, 'Try on my plan'],
  ];
  $('#qgrid').innerHTML = cards.map((c, i) => `<div class="qcard"><div style="display:flex;gap:10px;align-items:center"><div class="qn">${c[0]}</div><h3>${c[1]}</h3></div><div class="ans">${c[2]}</div><button class="btn ghost small" data-q="${i}">${c[4]}</button></div>`).join('');
  $$('#qgrid [data-q]').forEach(b => b.onclick = () => { const i = +b.dataset.q; if (i === 6) { showTab('scenarios'); setTimeout(() => { document.getElementById('stagedCard').scrollIntoView(); runStaged(); }, 50); } else go(cards[i][3])(); });
}

/* ------------------------------------------------------------------ four priorities */
function renderDemo() {
  if (!ARCH) return;
  const order = ['cost_minimizer', 'clean_champion', 'speed_maximizer', 'zero_tier2'], A = order.map(k => ARCH[k]).filter(Boolean);
  const obj = a => `${a.sense === 'min' ? 'Lowest' : 'Highest'} ${a.objective === 'levelized_cost' ? 'cost per MWh' : 'CO2 per MWh'}`;
  const cons = a => { const c = a.constraints, out = []; if (c.start_month) out.push(`opens month ${c.start_month}`); if (c.full_month_max) out.push(`full demand by month ${c.full_month_max}`); if (c.clean_share_min) out.push(`clean share over ${fmt0(c.clean_share_min * 100)}%`); if (c.tier2_interrupted_max_mwh === 0) out.push('no work paused'); return out.join(', '); };
  $('#demoBody').innerHTML = `<table class="t"><tr><th>Archetype</th><th>Goal and rules (from the framework)</th><th>Opens</th><th>What is built (MW)</th><th>$ per MWh</th><th>kg per MWh</th><th>Clean</th><th></th></tr>
    ${A.map(a => `<tr><td><b>${a.label}</b></td><td>${obj(a)}; ${cons(a)}</td><td>Month ${a.start}</td><td>${Object.entries(a.caps).filter(([, v]) => v).map(([k, v]) => `${ICONS[k]}${fmt0(v)}`).join(' ')}</td><td>${fmt(a.cost_per_mwh, 1)}</td><td>${fmt0(a.intensity)}</td><td>${fmt0(a.clean * 100)}%</td>
      <td><button class="btn ghost small" data-arch="${a.key}">Load</button></td></tr>`).join('')}</table>`;
  const cm = ARCH.cost_minimizer, cc = ARCH.clean_champion, sm = ARCH.speed_maximizer, z = ARCH.zero_tier2;
  const same = z && cm && JSON.stringify(z.caps) === JSON.stringify(cm.caps) && z.start === cm.start;
  $('#demoTip').innerHTML = tip(`Going from Cost Minimizer to Clean Champion cuts emissions from ${fmt0(cm.intensity)} to ${fmt0(cc.intensity)} kg/MWh for ${fmt(cc.cost_per_mwh - cm.cost_per_mwh, 1)} $ per MWh more. Opening in month 14 costs ${fmt(sm.cost_per_mwh - cm.cost_per_mwh, 1)} $ per MWh more than the cheapest plan.${same ? ' The cheapest plan already never pauses work, so it also wins Zero Tier 2.' : ''}`);
  $$('#demoBody [data-arch]').forEach(b => b.onclick = () => loadArchetype(b.dataset.arch));
}
function loadArchetype(k) {
  const a = ARCH[k];
  state.pin = null; state.custom = { key: k, label: a.label, caps: a.caps, start: a.start, lam: a.lam, allow_t2: a.allow_t2 };
  showTab('studio'); solve();
}

/* ------------------------------------------------------------------ extras, export, ledger */
function renderExt(d) {
  $('#stagedCard').innerHTML = `<h3>Buy capacity in stages</h3><p class="what">Would it be cheaper to add some capacity later instead of all at the start? Part of each contract or gas unit is delayed to month 30, 36, 48 or 60, and kept only if every hour is still powered. Land is still reserved for everything.</p>
    <button class="btn primary small" id="stagedBtn">Test on the current plan</button><div id="stagedOut" style="margin-top:12px"></div>`;
  $('#stagedBtn').onclick = runStaged;
}
async function runStaged() {
  if (!last || !last.feasible) return;
  const c = last.chosen, out = $('#stagedOut'); out.innerHTML = '<span class="spin"></span> searching';
  const r = await api('/api/staged', { caps: c.caps, start: c.start, lam: c.lam, switches: state.switches });
  out.innerHTML = `<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${KPI('All upfront', M(r.upfront_musd), 'ten-year cost', 'Cost if everything is bought at the start.')}${KPI('In stages', M(r.staged_musd), 'ten-year cost', 'Cost with part of the capacity added later.')}${KPI('Saving', M(r.saving_musd), 'by staging', 'Difference between the two.')}</div>
    ${r.ledger.length ? `<table class="t"><tr><th>Source</th><th>Delayed (MW)</th><th>Added in month</th><th>Months delayed</th></tr>${r.ledger.map(l => `<tr><td>${NAMES[l.option_id] || l.label}</td><td>${fmt0(l.stage2_mw)}</td><td>${l.stage2_month}</td><td>${l.months_deferred}</td></tr>`).join('')}</table>` : '<p>No staging beats buying everything upfront for this plan.</p>'}
    ${tip(r.saving_musd > 0.05 ? `Staging saves ${M(r.saving_musd)} without leaving any hour unpowered, because the delayed capacity is not needed until the grid reaches full size. Charges continue to month 120 once it is added.` : 'Buying everything upfront is as good as any staging tried.')}`;
}
function renderLedger(d) {
  $('#ledgerCard').innerHTML = `<h3>Where the money goes</h3><p class="what">Ten-year cost by source, using the official rules.</p><table class="t"><tr><th>Source</th><th>MW</th><th>Equipment</th><th>Energy and upkeep</th><th>Fuel</th><th>Total</th></tr>
    ${d.ledger.filter(l => l.selected_mw > 0).map(l => `<tr><td>${NAMES[l.option_id]}</td><td>${fmt0(l.selected_mw)}</td><td>${M(l.capacity_charges_usd / 1e6)}</td><td>${M(l.energy_payment_or_variable_om_usd / 1e6)}</td><td>${M(l.fuel_cost_usd / 1e6)}</td><td><b>${M(l.total_cost_usd / 1e6)}</b></td></tr>`).join('')}
    <tr><td>Bought on the market</td><td></td><td></td><td>${M(d.merchant_cost_usd / 1e6)}</td><td></td><td><b>${M(d.merchant_cost_usd / 1e6)}</b></td></tr></table>
    <p style="margin-top:8px">Energy cost <b>${M(d.local_energy_cost_usd / 1e6)}</b> + moved-work fees <b>${M(d.relocation_cost_usd / 1e6)}</b> + paused-work penalties <b>${M(d.interruption_consequence_usd / 1e6)}</b> = <b>${M(d.total_decision_cost_usd / 1e6)}</b>. The campus asked for ${fmt0(d.requested_mwh / 1000)} GWh and was served ${fmt0(d.local_served_mwh / 1000)} GWh on site. CO2: ${fmt0(d.local_operational_co2_t / 1000)} thousand tonnes on site plus ${fmt(d.remote_operational_co2_t / 1000, 2)} at the other site.</p>`;
}
function renderExport(res) {
  const c = res.chosen, d = res.detail, p = encodeURIComponent(JSON.stringify({ caps: c.caps, start: c.start, lam: c.lam, delay: state.switches.delay || 0 }));
  const pj = { initial_service_month: c.start, grid_delay_months: state.switches.delay || 0, capacities_mw: c.caps };
  $('#exportCard').innerHTML = `<h3>portfolio.json</h3><p class="what">How much of each source to build.</p><pre class="code">${JSON.stringify(pj, null, 2)}</pre>
    <div class="cta" style="margin:12px 0"><button class="btn primary small" id="dlJson">Download portfolio.json</button><a class="btn ghost small" href="submission/recommended/dispatch.csv" download="dispatch.csv">Download dispatch.csv</a><button class="btn ghost small" id="verifyBtn">Run the official checker</button></div>
    <p class="muted">dispatch.csv lists what runs in each of the 87,600 hours. Objective, constraints and accounting are read from <a href="data/framework.json" target="_blank">framework/framework.json</a>.</p>
    <div id="verifyOut">${d.common_model ? '' : '<p class="muted">What-if switches are on; the export uses the official model with only your grid delay.</p>'}</div>
    <p class="muted">Ready-made package: <a href="submission/RESULTS_SUMMARY.md" target="_blank">results summary</a>, <a href="submission/recommended/check_results.json" target="_blank">checker output</a>, <a href="submission/recommended/portfolio.json" target="_blank">portfolio.json</a>.</p>`;
  $('#dlJson').onclick = () => {
    const blob = new Blob([JSON.stringify(pj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'portfolio.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#verifyBtn').onclick = async () => {
    const o = $('#verifyOut'); o.innerHTML = '<span class="spin"></span> running the checker (about 15 seconds)';
    const r = await api('/api/verify', { caps: c.caps, start: c.start, lam: c.lam, delay: state.switches.delay || 0, allow_t2: state.custom ? state.custom.allow_t2 : true });
    o.innerHTML = r.ok ? `<div class="guard ok" style="margin:0"><div class="tick">&#10003;</div><div><b class="t">Checker passed</b><p>Cost ${M(r.checker.total_decision_cost_usd / 1e6)}, ${fmt(r.checker.combined_electricity_co2_kg_per_mwh, 1)} kg/MWh, ${fmt(r.checker.clean_energy_share * 100, 1)}% clean, land ${fmt(r.checker.land_acres, 2)} acres, peak grid draw ${fmt(r.checker.max_grid_import_mw, 1)} MW. Essential demand always served.</p></div></div>` : `<p style="color:#b8323f">${r.error}</p>`;
    if (r.audit) o.innerHTML += `<h3 style="margin-top:14px">Framework checks (section 9)</h3><table class="t">${r.audit.map(a => `<tr><td>${a.ok ? '<b class="good" style="color:#2e6b52">Pass</b>' : '<b style="color:#b8323f">Fail</b>'}</td><td>${a.check.replace(/^\d+ /, '')}</td><td class="muted">${a.detail}</td></tr>`).join('')}</table>`;
  };
}

/* ------------------------------------------------------------------ assistant */
const chat = { open: false, busy: false };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function addMsg(kind, html) { const m = document.createElement('div'); m.className = 'msg ' + kind; m.innerHTML = html; $('#asMsgs').appendChild(m); $('#asMsgs').scrollTop = 1e9; return m; }
function chips(list) { $('#asChips').innerHTML = (list || []).slice(0, 4).map(s => `<button>${esc(s)}</button>`).join(''); $$('#asChips button').forEach(b => b.onclick = () => ask(b.textContent)); }
function context() {
  if (!last || !last.feasible) return null;
  const c = last.chosen, d = last.detail;
  return { start: c.start, full_month: c.full_month, caps: c.caps, cost_musd: d.total_decision_cost_usd / 1e6, cost_per_mwh: d.decision_cost_usd_per_requested_mwh, intensity: d.combined_electricity_co2_kg_per_mwh, clean: d.clean_energy_share * 100, verdict: last.climate.verdict, why: last.explain };
}
async function ask(q) {
  q = (q || '').trim(); if (!q || chat.busy) return;
  addMsg('me', esc(q)); $('#asIn').value = ''; chat.busy = true;
  const wait = addMsg('bot', '<span class="spin"></span>');
  try {
    const r = await api('/api/assistant', { question: q, context: context() });
    wait.innerHTML = esc(r.answer) + (r.topic ? `<small>Topic: ${esc(r.topic)}</small>` : '');
    chips(r.suggestions);
  } catch (e) { wait.textContent = 'Sorry, I could not answer that right now.'; }
  chat.busy = false;
}
function initAssistant() {
  const toggle = open => {
    chat.open = open; $('#asPanel').hidden = !open;
    if (open) {
      if (!$('#asMsgs').children.length) { addMsg('bot', 'Hi, I can explain any term on this page or how the project works. Ask me anything, for example "What is a grid emergency?"'); chips(['What is this tool for?', 'What does the triangle do?', 'What is CO2 intensity?', 'Why was this plan recommended?']); }
      $('#asIn').focus();
    }
  };
  $('#asBtn').onclick = () => toggle(!chat.open); $('#asClose').onclick = () => toggle(false);
  $('#asForm').onsubmit = e => { e.preventDefault(); ask($('#asIn').value); };
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  $('#terms').innerHTML = TERMS.map(t => `<div class="card"><h3>${t[0]}</h3><p class="muted">${t[1]}</p></div>`).join('');
  initTabs(); buildTri(); buildPresets(); buildVals(); initAssistant();
  [META, LIBPTS] = await Promise.all([api('/api/meta'), api('/api/library')]);
  $('#st3').textContent = fmt0(META.library.portfolios);
  buildLimits(); solve();
  api('/api/questions').then(q => { QS = q; renderQuestions(); }).catch(() => $('#qgrid').innerHTML = '<p class="muted">Run build_all.py to prepare the answers.</p>');
  api('/api/framework').then(f => { FWK = f; }).catch(() => { });
  api('/api/archetypes').then(a => { ARCH = a; renderDemo(); }).catch(() => { });
}
boot();
