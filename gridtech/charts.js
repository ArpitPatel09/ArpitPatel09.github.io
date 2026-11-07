// Dependency-free SVG charts. Everything returns an SVG/HTML string; the server never renders.
export const COLORS = {
  utility_solar: '#f4cf63', wind: '#6fd3e0', nuclear: '#b79be0', battery_4h: '#3fbf8f',
  gas_engine: '#f5a65b', gas_turbine: '#ee7d77', fuel_cell: '#4fb7ae', merchant: '#7f93c9',
};
export const NAMES = {
  utility_solar: 'Solar power contract', wind: 'Wind power contract', nuclear: 'Nuclear power contract', battery_4h: 'Battery',
  gas_engine: 'Gas engine', gas_turbine: 'Gas turbine', fuel_cell: 'Fuel cell', merchant: 'Bought on the open market',
};
export const dot = k => `<i class="dot" style="background:${COLORS[k]}"></i>`;
export const ICONS = Object.fromEntries(Object.keys(COLORS).map(k => [k, dot(k)]));
export const fmt = (v, d = 1) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt0 = v => fmt(v, 0);

const arc = (cx, cy, r0, r1, a0, a1) => {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
};

export function donut(mix, cleanShare, totalMwh) {
  const order = ['utility_solar', 'wind', 'nuclear', 'battery_4h', 'gas_engine', 'gas_turbine', 'fuel_cell', 'merchant'];
  const total = order.reduce((s, k) => s + (mix[k] || 0), 0) || 1;
  let a = -Math.PI / 2, segs = '', legend = '';
  for (const k of order) {
    const v = mix[k] || 0;
    if (v <= 0) { legend += `<div class="lg off"><i style="background:${COLORS[k]}"></i><span>${NAMES[k]}</span><b>0%</b><small>not in this plan</small></div>`; continue; }
    const frac = v / total, a1 = a + frac * Math.PI * 2 - (frac < 0.999 ? 0.012 : 0);
    segs += `<path class="seg" d="${arc(130, 130, 78, 122, a, Math.max(a1, a + 0.01))}" fill="${COLORS[k]}"><title>${NAMES[k]}: ${fmt0(v)} MWh (${fmt(frac * 100)}%)</title></path>`;
    legend += `<div class="lg"><i style="background:${COLORS[k]}"></i><span>${ICONS[k]} ${NAMES[k]}</span><b>${fmt(frac * 100)}%</b></div>`;
    a += frac * Math.PI * 2;
  }
  return `<div class="donutwrap"><svg viewBox="0 0 260 260" class="donut">${segs}
    <text x="130" y="116" text-anchor="middle" class="dn-big">${fmt(cleanShare * 100)}%</text>
    <text x="130" y="138" text-anchor="middle" class="dn-sm">of your energy is clean</text>
    <text x="130" y="156" text-anchor="middle" class="dn-xs">${fmt(totalMwh / 1e6, 2)} TWh over 10 years</text></svg>
    <div class="legend">${legend}</div></div>`;
}

export function capacityBars(rows, landLimit) {
  const maxMw = Math.max(10, ...rows.map(r => r.mw));
  const used = rows.reduce((s, r) => s + r.acres, 0);
  let out = '<div class="capbars">';
  for (const r of rows) {
    if (r.mw <= 0) { out += `<div class="caprow off"><span class="capn">${ICONS[r.id]} ${NAMES[r.id] || r.label}</span><div class="captrack"></div><b>not selected</b><em class="chip ${r.onsite ? 'on' : 'off'}">${r.onsite ? 'onsite' : 'offsite'}</em></div>`; continue; }
    const w = (r.mw / maxMw) * 100;
    out += `<div class="caprow"><span class="capn">${ICONS[r.id]} ${NAMES[r.id] || r.label}</span>
      <div class="captrack"><div class="capfill" style="width:${w}%;background:${COLORS[r.id]}"></div></div>
      <b>${fmt0(r.mw)} MW${r.energy_mwh ? ` / ${fmt0(r.energy_mwh)} MWh` : ''}</b>
      <em class="chip ${r.onsite ? 'on' : 'off'}">${r.onsite ? fmt(r.acres, 2) + ' ac' : 'offsite · 0 ac'}</em></div>`;
  }
  const segs = rows.filter(r => r.acres > 0).map(r => `<div style="width:${(r.acres / landLimit) * 100}%;background:${COLORS[r.id]}" title="${NAMES[r.id]}: ${fmt(r.acres, 2)} acres"></div>`).join('');
  out += `<div class="landmeter"><div class="lmhead"><b>Onsite land</b><span>${fmt(used, 2)} of ${landLimit} acres (${fmt(used / landLimit * 100, 0)}%)</span></div>
    <div class="lmbar">${segs}<span class="lmfree"></span></div><small>Offsite contracts use no campus land.</small></div></div>`;
  return out;
}

export function barGroups(groups, series, { unit = '', height = 220, title = '' } = {}) {
  // groups: [{label, bars:[{v,color,name}]}]
  const W = 360, H = height, pad = { l: 44, r: 10, t: 24, b: 40 };
  const max = Math.max(...groups.flatMap(g => g.bars.map(b => b.v))) * 1.18 || 1;
  const gw = (W - pad.l - pad.r) / groups.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${pad.l}" y="14" class="ct">${title}</text>`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="gl"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="ax">${fmt((max * i) / 4, max > 50 ? 0 : 1)}</text>`;
  }
  groups.forEach((g, gi) => {
    const bw = Math.min(46, (gw - 14) / g.bars.length);
    g.bars.forEach((b, bi) => {
      const h = ((H - pad.t - pad.b) * b.v) / max;
      const x = pad.l + gi * gw + (gw - bw * g.bars.length) / 2 + bi * bw;
      s += `<rect x="${x}" y="${H - pad.b - h}" width="${bw - 6}" height="${h}" rx="3" fill="${b.color}"><title>${b.name}: ${fmt(b.v, 2)}${unit}</title></rect>
        <text x="${x + (bw - 6) / 2}" y="${H - pad.b - h - 5}" text-anchor="middle" class="bv">${fmt(b.v, b.v > 100 ? 0 : 2)}</text>`;
    });
    s += `<text x="${pad.l + gi * gw + gw / 2}" y="${H - 14}" text-anchor="middle" class="ax">${g.label}</text>`;
  });
  return s + '</svg>';
}

export function delayCurve(points) {
  const W = 560, H = 270, pad = { l: 52, r: 16, t: 26, b: 44 };
  const xs = d => pad.l + (W - pad.l - pad.r) * (d / 12);
  const maxV = Math.max(1, ...points.map(p => p.delta_musd)) * 1.15, minV = Math.min(0, ...points.map(p => p.delta_musd));
  const ys = v => pad.t + (H - pad.t - pad.b) * (1 - (v - minV) / (maxV - minV));
  const zc = { safe: '#d9f2e0', manageable: '#fff1c6', stress: '#fbd6d6' };
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${pad.l}" y="14" class="ct">Extra 10-year cost if the grid connection is late ($M)</text>`;
  for (let i = 0; i < points.length; i++) {
    const x0 = i === 0 ? xs(0) : (xs(i) + xs(i - 1)) / 2, x1 = i === points.length - 1 ? xs(12) : (xs(i) + xs(i + 1)) / 2;
    s += `<rect x="${x0}" y="${pad.t}" width="${x1 - x0}" height="${H - pad.t - pad.b}" fill="${zc[points[i].zone]}"/>`;
  }
  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) * i) / 4, y = ys(v);
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="gl"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="ax">${fmt(v, 1)}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs(p.delay)},${ys(p.delta_musd)}`).join(' ');
  s += `<path d="${path}" fill="none" stroke="#2f7d5b" stroke-width="3" stroke-linejoin="round"/>`;
  for (const p of points) {
    const bad = p.unmet_mwh > 1e-3;
    s += `<circle cx="${xs(p.delay)}" cy="${ys(p.delta_musd)}" r="${bad ? 6 : 4}" fill="${bad ? '#e0626f' : '#fff'}" stroke="${bad ? '#b8323f' : '#2f7d5b'}" stroke-width="2"><title>Delay ${p.delay} mo: ${p.delta_musd >= 0 ? '+' : ''}${fmt(p.delta_musd, 2)} $M, unserved ${fmt(p.unmet_mwh, 0)} MWh, ${fmt(p.delta_per_mwh, 2)} $/MWh</title></circle>`;
    s += `<text x="${xs(p.delay)}" y="${H - 24}" text-anchor="middle" class="ax">${p.delay}</text>`;
  }
  s += `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" class="ax">Grid connection delay (months)</text></svg>`;
  return s;
}

export function annualChart(rows) {
  const W = 560, H = 250, pad = { l: 46, r: 46, t: 26, b: 34 };
  const maxC = Math.max(...rows.map(r => r.cost_usd / 1e6)) * 1.15 || 1;
  const maxI = Math.max(1, ...rows.map(r => r.co2_kg_per_mwh || 0)) * 1.15;
  const bw = (W - pad.l - pad.r) / rows.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${pad.l}" y="14" class="ct">Each year: cost (bars, $M) and emissions per MWh (line)</text>`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="gl"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="ax">${fmt0((maxC * i) / 4)}</text><text x="${W - pad.r + 6}" y="${y + 3}" class="ax">${fmt0((maxI * i) / 4)}</text>`;
  }
  let line = '';
  rows.forEach((r, i) => {
    const h = ((H - pad.t - pad.b) * r.cost_usd / 1e6) / maxC, x = pad.l + i * bw + 6;
    s += `<rect x="${x}" y="${H - pad.b - h}" width="${bw - 12}" height="${h}" rx="3" fill="#bfe3c9"><title>Year ${r.model_year}: $${fmt(r.cost_usd / 1e6, 1)}M · ${fmt(r.cost_per_requested_mwh, 1)} $/MWh · clean ${fmt(r.clean_share * 100, 0)}%</title></rect><text x="${x + (bw - 12) / 2}" y="${H - 14}" text-anchor="middle" class="ax">Y${r.model_year}</text>`;
    const y = pad.t + (H - pad.t - pad.b) * (1 - (r.co2_kg_per_mwh || 0) / maxI);
    line += `${i ? 'L' : 'M'}${x + (bw - 12) / 2},${y}`;
  });
  s += `<path d="${line}" fill="none" stroke="#e0826f" stroke-width="3" stroke-linecap="round"/>`;
  return s + '</svg>';
}

export function eventTrace(ev) {
  const t = ev.trace;
  if (!t || !t.length) return '<p class="muted">No hours.</p>';
  const W = 560, H = 250, pad = { l: 40, r: 12, t: 28, b: 34 };
  const maxV = Math.max(...t.map(x => Math.max(x.demand, x.ordinary))) * 1.12;
  const bw = (W - pad.l - pad.r) / t.length;
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / maxV);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${pad.l}" y="14" class="ct">${ev.label} window, ${ev.window}, year 10 (MW)</text>`;
  for (let i = 0; i <= 4; i++) { const yy = y((maxV * i) / 4); s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" class="gl"/><text x="${pad.l - 5}" y="${yy + 3}" text-anchor="end" class="ax">${fmt0((maxV * i) / 4)}</text>`; }
  const comps = [['imports', '#7f93c9', 'Grid imports'], ['gas', '#f5a65b', 'Onsite gas'], ['battery', '#3fbf8f', 'Battery'], ['relocated', '#c9b6ec', 'Moved to another site'], ['interrupted', '#f0a0a8', 'Work paused'], ['unmet', '#c0283a', 'Not delivered']];
  t.forEach((x, i) => {
    let base = 0; const bx = pad.l + i * bw;
    if (x.in_event) s += `<rect x="${bx}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="#fff4cc" opacity=".55"/>`;
    for (const [k, c] of comps) {
      const v = Math.max(x[k] || 0, 0); if (!v) continue;
      s += `<rect x="${bx + 3}" y="${y(base + v)}" width="${bw - 6}" height="${y(base) - y(base + v)}" fill="${c}"><title>${k}: ${fmt(v, 1)} MW</title></rect>`; base += v;
    }
    s += `<text x="${bx + bw / 2}" y="${H - 16}" text-anchor="middle" class="ax">${x.h}h</text>`;
  });
  const cap = t.map((x, i) => `${i ? 'L' : 'M'}${pad.l + i * bw + bw / 2},${y(x.cap)}`).join(' ');
  s += `<path d="${cap}" fill="none" stroke="#c0283a" stroke-width="2.5" stroke-dasharray="6 4"/><text x="${W - pad.r}" y="${pad.t - 6}" text-anchor="end" class="ax" fill="#c0283a">dashed line = grid import limit</text>`;
  return s + `</svg><div class="legend inline">${comps.map(c => `<span><i style="background:${c[1]}"></i>${c[2]}</span>`).join('')}</div>`;
}

export function waitingCurve(points, months, chosen) {
  const W = 560, H = 270, pad = { l: 46, r: 46, t: 28, b: 38 };
  const ms = months.filter(m => m <= 42);
  const pm = m => points.filter(p => p.start === m);
  const cheap = ms.map(m => { const r = pm(m); return r.length ? Math.min(...r.map(p => p.cost)) : null; });
  const clean = ms.map(m => { const r = pm(m); return r.length ? Math.min(...r.map(p => p.intensity)) : null; });
  const cmin = Math.min(...cheap.filter(Boolean)) * 0.9, cmax = Math.max(...cheap.filter(Boolean)) * 1.05;
  const imin = Math.min(...clean.filter(Boolean)) * 0.8, imax = Math.max(...points.filter(p => p.start <= 42).map(p => p.intensity)) * 0.5;
  const x = m => pad.l + (W - pad.l - pad.r) * ((m - 14) / 28);
  const yc = v => pad.t + (H - pad.t - pad.b) * (1 - (v - cmin) / (cmax - cmin));
  const yi = v => pad.t + (H - pad.t - pad.b) * (1 - (v - imin) / (imax - imin));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${pad.l}" y="14" class="ct">Opening month: cheapest cost (green, $/MWh) and lowest emissions (blue, kg/MWh)</text>`;
  for (let i = 0; i <= 4; i++) { const yy = pad.t + (H - pad.t - pad.b) * (1 - i / 4); s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" class="gl"/><text x="${pad.l - 5}" y="${yy + 3}" text-anchor="end" class="ax">${fmt0(cmin + (cmax - cmin) * i / 4)}</text><text x="${W - pad.r + 5}" y="${yy + 3}" class="ax">${fmt0(imin + (imax - imin) * i / 4)}</text>`; }
  const line = (arr, f, c) => arr.map((v, i) => v == null ? '' : `${i ? 'L' : 'M'}${x(ms[i])},${f(v)}`).join(' ');
  s += `<path d="${line(cheap, yc)}" fill="none" stroke="#3f9d73" stroke-width="3"/><path d="${line(clean, yi)}" fill="none" stroke="#6aa8e0" stroke-width="3"/>`;
  ms.forEach((m, i) => { if (m % 4 === 0 || m === 14) s += `<text x="${x(m)}" y="${H - 18}" text-anchor="middle" class="ax">${m}</text>`; });
  s += `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" class="ax">Initial-service month (full demand = +10)</text>`;
  if (chosen && chosen.start <= 42) s += `<line x1="${x(chosen.start)}" x2="${x(chosen.start)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#e0826f" stroke-dasharray="5 4" stroke-width="2"/><text x="${x(chosen.start) + 4}" y="${pad.t + 12}" class="ax" fill="#c0614f">your pick: month ${chosen.start}</text>`;
  return s + '</svg>';
}
