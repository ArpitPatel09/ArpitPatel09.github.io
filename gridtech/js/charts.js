/* Small canvas charts: 72-hour dispatch strip and the cost-vs-CO2 trade-off scatter. */

function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
}

/** layers: [{color, values: Float64Array}] stacked bottom-up; load: demand line; cap: import cap line; cursor index */
export function drawSpark(canvas, { layers, load, from, to, cursor, stress }) {
    const { g, w, h } = fit(canvas);
    g.clearRect(0, 0, w, h);
    const n = to - from;
    if (n <= 1) return;
    let max = 1;
    for (let i = from; i < to; i++) {
        let s = 0;
        for (const l of layers) s += Math.max(0, l.values[i]);
        max = Math.max(max, s, load[i]);
    }
    max *= 1.12;
    const X = i => ((i - from) / (n - 1)) * w;
    const Y = v => h - 6 - (v / max) * (h - 14);
    // stress shading
    g.fillStyle = 'rgba(255,94,87,0.16)';
    for (let i = from; i < to; i++) if (stress[i]) g.fillRect(X(i) - w / n / 2, 0, w / n + 0.5, h);
    const base = new Float64Array(n);
    for (const l of layers) {
        g.beginPath();
        for (let i = 0; i < n; i++) g.lineTo(X(from + i), Y(base[i] + Math.max(0, l.values[from + i])));
        for (let i = n - 1; i >= 0; i--) g.lineTo(X(from + i), Y(base[i]));
        g.closePath();
        g.fillStyle = l.color;
        g.globalAlpha = 0.85;
        g.fill();
        g.globalAlpha = 1;
        for (let i = 0; i < n; i++) base[i] += Math.max(0, l.values[from + i]);
    }
    g.beginPath();
    for (let i = 0; i < n; i++) g.lineTo(X(from + i), Y(load[from + i]));
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.stroke();
    g.setLineDash([]);
    const cx = X(cursor);
    g.fillStyle = '#f5c542';
    g.fillRect(cx - 1, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '10px Inter, sans-serif';
    g.fillText(`${Math.round(max / 1.12)} MW`, 6, 12);
}

/** Scatter of $/MWh (x) vs kg CO2/MWh (y). Returns a hit-test function. */
export function drawPareto(canvas, rows, chosen, frontier) {
    const { g, w, h } = fit(canvas);
    g.clearRect(0, 0, w, h);
    if (!rows.length) {
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.font = '12px Inter, sans-serif';
        g.fillText('Run the optimizer to see the trade-off', 14, h / 2);
        return () => null;
    }
    const pad = { l: 38, r: 10, t: 12, b: 26 };
    const xs = rows.map(r => r.usd_mwh), ys = rows.map(r => r.kg);
    const x0 = Math.min(...xs) * 0.97, x1 = Math.max(...xs) * 1.02;
    const y0 = 0, y1 = Math.max(...ys) * 1.06;
    const X = v => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const Y = v => h - pad.b - ((v - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = '10px Inter, sans-serif';
    g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
        const yv = y0 + ((y1 - y0) * k) / 4, yy = Y(yv);
        g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(w - pad.r, yy); g.stroke();
        g.fillText(Math.round(yv), 6, yy + 3);
        const xv = x0 + ((x1 - x0) * k) / 4, xx = X(xv);
        g.fillText('$' + Math.round(xv), xx - 8, h - 8);
    }
    g.save();
    g.translate(10, pad.t + 4);
    g.restore();
    const starts = rows.map(r => r.start);
    const s0 = Math.min(...starts), s1 = Math.max(...starts);
    for (const r of rows) {
        const t = s1 > s0 ? (r.start - s0) / (s1 - s0) : 0;
        g.fillStyle = `hsla(${190 - t * 150}, 80%, 62%, 0.55)`;
        g.beginPath();
        g.arc(X(r.usd_mwh), Y(r.kg), 2.6, 0, Math.PI * 2);
        g.fill();
    }
    if (frontier && frontier.length > 1) {
        g.strokeStyle = 'rgba(245,197,66,0.6)';
        g.lineWidth = 1.5;
        g.beginPath();
        frontier.forEach(r => g.lineTo(X(r.usd_mwh), Y(r.kg)));
        g.stroke();
    }
    if (chosen) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.fillStyle = '#f5c542';
        g.beginPath();
        g.arc(X(chosen.usd_mwh), Y(chosen.kg), 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('kg CO₂/MWh', pad.l + 4, pad.t + 2);
    g.fillText(`opening M${s0}`, w - 130, pad.t + 2);
    g.fillStyle = 'hsla(190,80%,62%,1)'; g.fillRect(w - 62, pad.t - 5, 8, 8);
    g.fillStyle = 'hsla(40,80%,62%,1)'; g.fillRect(w - 52, pad.t - 5, 8, 8);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillText(`M${s1}`, w - 40, pad.t + 2);
    return (px, py) => {
        let best = null, bd = 14 * 14;
        for (const r of rows) {
            const d = (X(r.usd_mwh) - px) ** 2 + (Y(r.kg) - py) ** 2;
            if (d < bd) { bd = d; best = r; }
        }
        return best;
    };
}
