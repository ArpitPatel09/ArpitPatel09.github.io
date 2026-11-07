/* Recommendation + search (port of engine/recommend.py and engine/search.py).
 *
 * recommend(): hard limits filter the candidate plans, survivors are ranked with augmented
 *   Tchebycheff  max(w*n) + 0.01*sum(w*n)  on min-max normalised metrics (same as the hackathon).
 * searchMonth(): continuation local search over a carbon-price ladder for one opening month,
 *   used when a visitor changes the world (site, grid, prices) so the precomputed library no
 *   longer applies. Every feasible portfolio it touches goes into the pool.
 */
import { IDS, CATALOG, limitsFor, landUsed } from './engine.js';

export const METRICS = {
    full: { label: 'Full-demand month', unit: 'month', dir: 'low' },
    start: { label: 'Service start month', unit: 'month', dir: 'low' },
    usd_mwh: { label: 'Cost per MWh', unit: '$/MWh', dir: 'low' },
    total: { label: '10-year total', unit: '$M', dir: 'low' },
    kg: { label: 'CO2 intensity', unit: 'kg/MWh', dir: 'low' },
    clean: { label: 'Clean share', unit: '%', dir: 'high' },
};
const AXES = { speed: 'full', cost: 'usd_mwh', env: 'kg' };

export function mval(r, key) {
    switch (key) {
        case 'full': return r.full;
        case 'start': return r.start;
        case 'usd_mwh': return r.usd_mwh;
        case 'total': return r.total / 1e6;
        case 'kg': return r.kg;
        case 'clean': return 100 * r.clean;
    }
    throw new Error(key);
}

export function libraryRows(lib) {
    const F = lib.fields;
    return lib.rows.map((a, i) => {
        const r = {};
        F.forEach((f, j) => (r[f] = a[j]));
        r.caps = Object.fromEntries(lib.ids.map((k, j) => [k, a[F.indexOf('caps')][j]]));
        r.feasible = !!r.feasible;
        r.id = `L${i}`;
        r.source = 'library';
        return r;
    });
}

export function rowFromEval(m, extra = {}) {
    return {
        start: m.start, full: m.full, caps: { ...m.caps }, lam: m.lam, total: m.total, usd_mwh: m.usd_mwh, kg: m.kg, clean: m.clean,
        merchant: m.merchant, co2_t: m.co2_t, reloc: m.reloc, intr: m.intr, served: m.served, requested: m.requested,
        land: m.land, feasible: m.feasible, fixed: m.fixed, ...extra,
    };
}

function normWeights(w) {
    const s = Math.max(0, w.speed || 0), c = Math.max(0, w.cost || 0), e = Math.max(0, w.env || 0);
    const t = s + c + e;
    return t <= 0 ? [1 / 3, 1 / 3, 1 / 3] : [s / t, c / t, e / t];
}

export function rank(rows, weights) {
    const w = normWeights(weights);
    const keys = [AXES.speed, AXES.cost, AXES.env];
    const raw = rows.map(r => keys.map(k => (METRICS[k].dir === 'high' ? -mval(r, k) : mval(r, k))));
    const lo = keys.map((_, i) => Math.min(...raw.map(v => v[i])));
    const hi = keys.map((_, i) => Math.max(...raw.map(v => v[i])));
    const scored = rows.map((r, j) => {
        const n = raw[j].map((v, i) => (hi[i] - lo[i] < 1e-12 ? 0 : (v - lo[i]) / (hi[i] - lo[i])));
        const wn = n.map((v, i) => w[i] * v);
        return { r, score: Math.max(...wn) + 0.01 * wn.reduce((a, b) => a + b, 0), sumN: n.reduce((a, b) => a + b, 0) };
    });
    scored.sort((a, b) => a.score - b.score || a.sumN - b.sumN || (a.r.id < b.r.id ? -1 : 1));
    return scored.map(x => Object.assign(x.r, { score: x.score }));
}

/**
 * prefs = { weights:{speed,cost,env}, fullBy: month|null, maxUsd: $/MWh|null, maxKg: kg|null, minClean: %|null,
 *           neverPause: bool, horizon: month (planning window for full demand, default 40) }
 */
export function recommend(rows, prefs) {
    const horizon = prefs.fullBy ?? prefs.horizon ?? 40;
    const scope = rows.filter(r => r.feasible && r.full <= Math.max(horizon, 40));
    const limits = [
        ['speed', 'full', prefs.fullBy],
        ['cost', 'usd_mwh', prefs.maxUsd],
        ['env', 'kg', prefs.maxKg],
        ['clean', 'clean', prefs.minClean],
    ].filter(l => l[2] != null && l[2] !== '');
    const passes = (r, skip) => {
        if (prefs.neverPause && skip !== 'pause' && r.intr > 1e-6) return false;
        for (const [axis, key, lim] of limits) {
            if (axis === skip) continue;
            const v = mval(r, key);
            if (METRICS[key].dir === 'high' ? v < lim - 1e-6 : v > lim + 1e-6) return false;
        }
        return true;
    };
    const survivors = scope.filter(r => passes(r));
    const out = { scope, survivors, ranked: [], chosen: null, relax: [] };
    if (survivors.length) {
        out.ranked = rank(survivors.slice(), prefs.weights);
        out.chosen = out.ranked[0];
    } else {
        // never "impossible": relax one limit at a time to its nearest feasible value
        for (const [axis, key] of limits) {
            const s = scope.filter(r => passes(r, axis));
            if (!s.length) continue;
            const high = METRICS[key].dir === 'high';
            const vals = s.map(r => mval(r, key));
            const nearest = high ? Math.max(...vals) : Math.min(...vals);
            const pool = s.filter(r => (high ? mval(r, key) >= nearest - 1e-6 : mval(r, key) <= nearest + 1e-6));
            out.relax.push({ axis, key, value: nearest, pick: rank(pool, prefs.weights)[0] });
        }
        if (prefs.neverPause) {
            const s = scope.filter(r => passes(r, 'pause'));
            if (s.length) out.relax.push({ axis: 'pause', key: 'intr', value: null, pick: rank(s, prefs.weights)[0] });
        }
    }
    if (out.chosen) out.climate = climateCheck(out.chosen, scope, prefs);
    out.archetypes = archetypes(scope);
    out.frontier = pareto(scope);
    return out;
}

/** Hackathon "climate check": is a materially cleaner plan available below the customer's $/t hurdle? */
export function climateCheck(chosen, pool, prefs) {
    const hurdle = prefs.hurdle ?? 100;
    const h = hurdle / 1000;
    const social = r => r.usd_mwh + h * r.kg;
    const cand = pool.filter(r => r.start <= chosen.start + 3 && (prefs.fullBy == null || r.full <= prefs.fullBy) && (!prefs.neverPause || r.intr <= 1e-6));
    const best = cand.reduce((b, r) => (social(r) < social(b) ? r : b), chosen);
    const cut = chosen.kg - best.kg;
    const cutPct = chosen.kg > 0 ? (100 * cut) / chosen.kg : 0;
    if (best !== chosen && cutPct >= 10) {
        const dcm = best.usd_mwh - chosen.usd_mwh;
        const implied = cut > 0 ? dcm / (cut / 1000) : 0;
        if (implied <= hurdle) return { verdict: 'pivot', hurdle, pivot: best, implied, cutPct, dcm };
    }
    return { verdict: chosen.kg > 200 ? 'weak' : 'efficient', hurdle };
}

export function archetypes(scope) {
    if (!scope.length) return {};
    const by = (f, tie) => scope.slice().sort((a, b) => f(a) - f(b) || tie(a) - tie(b))[0];
    const fastest = Math.min(...scope.map(r => r.start));
    const speedPool = scope.filter(r => r.start === fastest);
    const cleanPool = scope.filter(r => r.clean >= 0.7);
    return {
        cost: { label: 'Cost Minimizer', row: by(r => r.usd_mwh, r => r.kg) },
        clean: { label: 'Clean Champion', row: (cleanPool.length ? cleanPool : scope).slice().sort((a, b) => a.kg - b.kg || a.usd_mwh - b.usd_mwh)[0] },
        speed: { label: 'Speed Maximizer', row: speedPool.slice().sort((a, b) => a.usd_mwh - b.usd_mwh)[0] },
        zero: { label: 'Zero work paused', row: by(r => (r.intr > 1e-6 ? 1e9 : 0) + r.usd_mwh, r => r.kg) },
    };
}

export function pareto(rows) {
    const s = rows.slice().sort((a, b) => a.usd_mwh - b.usd_mwh || a.kg - b.kg);
    const out = [];
    let best = Infinity;
    for (const r of s) if (r.kg < best - 1e-9) { out.push(r); best = r.kg; }
    return out;
}

/* ------------------------------------------------------------------ search (engine/search.py) */

export const LAM_LADDER = [0, 150, 1000];

export function capsToUnits(caps, lim) {
    return IDS.map(k => Math.max(0, Math.min(lim[k].units, Math.round((caps[k] || 0) / lim[k].block))));
}
export function unitsToCaps(u, lim) {
    return Object.fromEntries(IDS.map((k, i) => [k, u[i] * lim[k].block]));
}

/**
 * Local search for one opening month. `seeds` = list of caps objects. Calls onEval(caps, metrics) after every new evaluation.
 * Returns the pool of feasible rows evaluated.
 */
export function searchMonth(E, world, month, seeds, { budget = 90, lams = LAM_LADDER, onEval } = {}) {
    const spec = { ...world, start: month };
    const site = world.site;
    const lim = limitsFor(site);
    const landLimit = site.landLimit;
    const cache = new Map();
    const pool = [];
    let evals = 0;
    const ev = (u, lam) => {
        const key = u.join(',') + '|' + lam;
        let r = cache.get(key);
        if (!r) {
            const caps = unitsToCaps(u, lim);
            const m = E.evaluate(caps, spec, lam);
            evals++;
            r = { f: m.feasible, cost: m.total, co2: m.co2_t, unmet: m.unmet };
            cache.set(key, r);
            if (m.feasible) pool.push(rowFromEval(m, { id: `S${month}-${pool.length}`, source: 'search' }));
            onEval && onEval(caps, m, evals);
        }
        return r;
    };
    const obj = (u, lam) => {
        const r = ev(u, lam);
        return r.f ? r.cost + lam * r.co2 : 5e9 + 2e5 * r.unmet + r.cost * 0.001;
    };
    const okUnits = u => u.every((v, i) => v >= 0 && v <= lim[IDS[i]].units) && landUsed(unitsToCaps(u, lim)) <= landLimit + 1e-7;

    // firm-gas repair: add the onsite block that cuts unserved energy most until the plan serves every hour
    const repair = (u, lam) => {
        for (let step = 0; step < 12; step++) {
            const r = ev(u, lam);
            if (r.f) return u;
            let best = null;
            for (const k of ['gas_engine', 'fuel_cell', 'gas_turbine', 'battery_4h']) {
                const v = u.slice();
                v[IDS.indexOf(k)] += k === 'battery_4h' ? 4 : 1;
                if (!okUnits(v)) continue;
                const rr = ev(v, lam);
                const key = rr.unmet * 1e3 + rr.cost * 1e-9;
                if (!best || key < best[0]) best = [key, v];
            }
            if (!best) return u;
            u = best[1];
        }
        return u;
    };

    let u = null;
    let perLam = Math.max(12, Math.floor(budget / lams.length));
    for (const lam of lams) {
        const stop = evals + perLam;
        // start from the best seed under this lambda (continuation: previous solution is a seed too)
        const cands = seeds.map(c => capsToUnits(c, lim)).filter(okUnits);
        if (u) cands.unshift(u);
        let bestU = null, bestO = Infinity;
        for (const c of cands) {
            const o = obj(c, lam);
            if (o < bestO) { bestO = o; bestU = c; }
        }
        u = repair(bestU || IDS.map(() => 0), lam);
        if (!ev(u, lam).f && !pool.length) break; // nothing firm enough fits this opening month: stop spending evaluations here
        bestO = obj(u, lam);
        const steps = [1, -1, 2, -2, 4, -4];
        let improved = true;
        while (improved && evals < stop) {
            improved = false;
            const dims = IDS.map((_, i) => i).sort(() => Math.random() - 0.5);
            for (const i of dims) {
                if (CATALOG[IDS[i]].avail > 120) continue;
                for (const d of steps) {
                    const v = u.slice();
                    v[i] += d;
                    if (!okUnits(v)) continue;
                    const o = obj(v, lam);
                    if (o < bestO - 1) { u = v; bestO = o; improved = true; break; }
                    if (evals >= stop) break;
                }
                if (evals >= stop) break;
            }
        }
    }
    return { pool, evals };
}

/**
 * Re-dispatch library plans under a changed world (grid delay, stress switches, heat derate) and repair any plan that no
 * longer serves every hour with extra firm onsite blocks (engine/recommend.py `_reeval` + `repair_caps`).
 */
export function reevalRows(E, world, rows, onEval) {
    const lim = limitsFor(world.site);
    const out = [];
    for (const row of rows) {
        const spec = { ...world, start: row.start };
        let caps = { ...row.caps };
        let m = E.evaluate(caps, spec, row.lam);
        let repaired = false;
        for (let step = 0; step < 10 && !m.feasible; step++) {
            let best = null;
            for (const k of ['gas_engine', 'fuel_cell', 'gas_turbine']) {
                const v = { ...caps, [k]: (caps[k] || 0) + lim[k].block };
                if (v[k] > lim[k].max + 1e-9 || landUsed(v) > world.site.landLimit + 1e-9) continue;
                const mm = E.evaluate(v, spec, row.lam);
                if (!best || mm.unmet < best[1].unmet - 1e-6 || (Math.abs(mm.unmet - best[1].unmet) < 1e-6 && mm.total < best[1].total)) best = [v, mm];
            }
            if (!best) break;
            [caps, m] = best;
            repaired = true;
        }
        onEval && onEval(caps, m);
        if (m.feasible) out.push(rowFromEval(m, { id: row.id + (repaired ? 'r' : ''), source: 'reeval', repaired }));
    }
    return out;
}

/** Seeds for a custom world: benchmark library plans for the nearest opening month, scaled to the campus size. */
export function seedsFor(libRows, month, site) {
    const months = [...new Set(libRows.map(r => r.start))];
    const near = months.reduce((b, m) => (Math.abs(m - month) < Math.abs(b - month) ? m : b), months[0]);
    const rows = libRows.filter(r => r.start === near && r.feasible);
    const s = site.peakMw / 75;
    const pick = [];
    const sorted = rows.slice().sort((a, b) => a.usd_mwh - b.usd_mwh);
    for (const f of [0, 0.35, 0.7, 1]) pick.push(sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))]);
    return pick.filter(Boolean).map(r => {
        const c = {};
        for (const k of IDS) c[k] = (r.caps[k] || 0) * s * (k === 'utility_solar' ? 1 / Math.max(site.solarMult, 0.3) : k === 'wind' ? 1 / Math.max(site.windMult, 0.3) : 1);
        return c;
    });
}

/** Opening months worth searching for a custom world. */
export function candidateMonths(world, prefs) {
    const delay = world.delay || 0;
    const latestFull = prefs.fullBy ?? 40;
    const latest = Math.max(14, Math.min(42, latestFull - 10));
    const grid = world.site.grid.filter(g => g.mw > 0).map(g => g.from + delay);
    const set = new Set([14, latest]);
    for (const g of grid) for (const m of [g, g - 10]) if (m >= 14 && m <= latest) set.add(m);
    const mid = Math.round((14 + latest) / 2);
    set.add(mid);
    return [...set].sort((a, b) => a - b).slice(0, 7);
}
