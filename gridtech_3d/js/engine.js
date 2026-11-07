/* GridTech engine (browser port).
 *
 * A line-for-line JavaScript port of the hackathon engine (engine/data.py, dispatch.py, model.py):
 * 120 model months x 730 h = 87,600 chronological hours, the packet's commissioning ramp,
 * grid-access schedule, price/CO2 trajectories, 7 ERCOT stress windows and the common accounting.
 * The default Spec reproduces the checker-verified Submission_Package numbers.
 *
 * Extra "site" knobs (peak MW, renewable resource multipliers, grid schedule, prices) let a visitor
 * describe their own campus; they scale the Texas reference shapes, which is a screening shortcut,
 * not a weather model for another location.
 */

export const IDS = ['utility_solar', 'wind', 'battery_4h', 'gas_turbine', 'gas_engine', 'fuel_cell', 'nuclear'];
export const N = 87600;
export const HPY = 8760;
export const HPM = 730;

export const CATALOG = {
    utility_solar: { label: 'Utility solar contract', short: 'Solar', location: 'offsite', block: 5, max: 150, avail: 24, capex: 0, fom: 0, life: 20, price: 40, basis: 'available', hr: 0, co2: 0, land: 0 },
    wind:          { label: 'Wind contract', short: 'Wind', location: 'offsite', block: 5, max: 200, avail: 12, capex: 0, fom: 0, life: 20, price: 35, basis: 'available', hr: 0, co2: 0, land: 0 },
    battery_4h:    { label: '4-hour battery', short: 'Battery', location: 'onsite', block: 1, max: 12, avail: 14, capex: 1744, fom: 40, life: 15, price: 0, basis: 'dispatched', hr: 0, co2: 0, land: 0.15 },
    gas_turbine:   { label: 'Gas turbine', short: 'Turbine', location: 'onsite', block: 25, max: 75, avail: 18, capex: 1606, fom: 9.56, life: 25, price: 5.7, basis: 'dispatched', hr: 9.447, co2: 0.50135519296863, land: 0.1 },
    gas_engine:    { label: 'Gas reciprocating engine', short: 'Engines', location: 'onsite', block: 5, max: 60, avail: 16, capex: 2400, fom: 25, life: 20, price: 12, basis: 'dispatched', hr: 8.454, co2: 0.44865637782966, land: 0.05 },
    fuel_cell:     { label: 'Natural-gas fuel cell', short: 'Fuel cells', location: 'onsite', block: 5, max: 30, avail: 14, capex: 4000, fom: 150, life: 15, price: 5, basis: 'dispatched', hr: 6.5, co2: 0.3449569973849999, land: 0.05 },
    nuclear:       { label: 'Offsite nuclear PPA', short: 'Nuclear', location: 'offsite', block: 5, max: 25, avail: 60, capex: 0, fom: 0, life: 20, price: 95, basis: 'available', hr: 0, co2: 0, land: 0 },
};

export const RULES = {
    discount: 0.08,
    eta: Math.sqrt(0.85),
    battHours: 4,
    battCycles: 365,
    ramp: 10,                 // months from 1/3 load to full load
    stressFraction: 0.6,
    remoteMw: 12, remoteMult: 1.05, relocPrice: 123.5, intrPrice: 1000,
    landLimit: 8,
    holdHours: 48, drainHours: 168,
    heatDerate: { gas_turbine: 0.007 * 25 * (1 - 0.514), gas_engine: 0.005 * 5, fuel_cell: 0 },
};

export const BENCHMARK_GRID = [{ from: 0, mw: 0 }, { from: 18, mw: 25 }, { from: 24, mw: 50 }, { from: 30, mw: 75 }];

const crf = (r, n) => r * (1 + r) ** n / ((1 + r) ** n - 1);

/** Default site = the hackathon benchmark (fictional 75 MW campus, Williamson County TX). */
export function defaultSite() {
    return {
        peakMw: 75, grid: BENCHMARK_GRID.map(g => ({ ...g })), landLimit: 8,
        solarMult: 1, windMult: 1, priceMult: 1, gasMult: 1, gridCo2Mult: 1,
        prices: { utility_solar: 40, wind: 35, nuclear: 95 },
    };
}

export function defaultSpec(start = 20) {
    return { start, delay: 0, eventsOff: [], allowT1: true, allowT2: true, heat: false, outage: 0, site: defaultSite() };
}

export function isBenchmarkSite(site) {
    const d = defaultSite();
    if (site.peakMw !== d.peakMw || site.landLimit !== d.landLimit) return false;
    for (const k of ['solarMult', 'windMult', 'priceMult', 'gasMult', 'gridCo2Mult']) if (Math.abs(site[k] - 1) > 1e-9) return false;
    for (const k in d.prices) if (site.prices[k] !== d.prices[k]) return false;
    if (site.grid.length !== d.grid.length) return false;
    return site.grid.every((g, i) => g.from === d.grid[i].from && g.mw === d.grid[i].mw);
}

/** Catalog limits scaled to the campus size (blocks stay the same, maxima scale with peak MW). */
export function limitsFor(site) {
    const s = site.peakMw / 75;
    const out = {};
    for (const k of IDS) {
        const c = CATALOG[k];
        const max = Math.max(c.block, Math.round((c.max * s) / c.block) * c.block);
        out[k] = { block: c.block, max, units: Math.round(max / c.block) };
    }
    return out;
}

export function landUsed(caps) {
    let a = 0;
    for (const k of IDS) a += (caps[k] || 0) * CATALOG[k].land;
    return a;
}

/* ------------------------------------------------------------------ reference data */

export function createEngine(meta, buffer) {
    const f = new Float32Array(buffer);
    const H = meta.hours;
    const col = name => f.subarray(meta.columns.indexOf(name) * H, (meta.columns.indexOf(name) + 1) * H);
    const R = {};
    for (const c of meta.columns) R[c] = col(c);

    // 87,600-hour clock and trajectories (data.py)
    const REF = new Int32Array(N), MONTH = new Int32Array(N), YEAR = new Int32Array(N);
    const M_W = new Float64Array(N), M_G = new Float64Array(N), M_C = new Float64Array(N);
    const rates = meta.rates;
    for (let h = 0; h < N; h++) {
        REF[h] = h % HPY; MONTH[h] = Math.floor(h / HPM); YEAR[h] = Math.floor(h / HPY);
        const y = h / HPY;
        M_W[h] = (1 + rates.wholesale_energy) ** y;
        M_G[h] = (1 + rates.henry_hub) ** y;
        M_C[h] = (1 + rates.grid_co2) ** y;
    }
    const SUMMER_PM = new Uint8Array(HPY);
    for (let i = 0; i < HPY; i++) {
        const m = R.cal_month[i], hod = R.hod[i];
        SUMMER_PM[i] = m >= 6 && m <= 9 && hod >= 11 && hod < 20 ? 1 : 0;
    }

    const scCache = new Map();

    /** Expand one world (Spec) into hourly arrays. Mirrors data.build(). */
    function buildScenario(spec) {
        const site = spec.site || defaultSite();
        const key = JSON.stringify([spec.start, spec.delay, spec.eventsOff, spec.allowT1, spec.allowT2, spec.heat, spec.outage, site]);
        const hit = scCache.get(key);
        if (hit) return hit;
        const scale = site.peakMw / 75;
        const load = new Float64Array(N), t1 = new Float64Array(N), t2 = new Float64Array(N);
        const cap = new Float64Array(N), ordinary = new Float64Array(N);
        const stress = new Uint8Array(N), evIdx = new Int8Array(N);
        const relocLim = new Float64Array(N), intrLim = new Float64Array(N), mustLocal = new Float64Array(N);
        const gasPrice = new Float64Array(N), gridPrice = new Float64Array(N), gridCo2 = new Float64Array(N);
        const windCf = new Float64Array(N), solarCf = new Float64Array(N);
        const gf = { gas_turbine: new Float64Array(N), gas_engine: new Float64Array(N), fuel_cell: new Float64Array(N) };
        const off = new Set(spec.eventsOff || []);
        const grid = [...site.grid].sort((a, b) => a.from - b.from);
        const remoteLocal = (RULES.remoteMw * scale) / RULES.remoteMult;
        const outage = spec.outage || 0;
        for (let h = 0; h < N; h++) {
            const r = REF[h];
            const rel = MONTH[h] - spec.start;
            const frac = rel < 0 ? 0 : rel >= RULES.ramp ? 1 : 1 / 3 + (rel * (2 / 3)) / RULES.ramp;
            const L = R.load[r] * scale * frac;
            load[h] = L;
            t1[h] = R.t1[r] * scale * frac;
            t2[h] = R.t2[r] * scale * frac;
            let ord = 0;
            for (const g of grid) if (MONTH[h] >= g.from + (g.mw > 0 ? spec.delay : 0)) ord = g.mw;
            ordinary[h] = ord;
            const e = R.event[r];
            const act = e >= 0 && !off.has(e);
            stress[h] = act ? 1 : 0;
            evIdx[h] = act ? e : -1;
            cap[h] = act ? ord * RULES.stressFraction : ord;
            relocLim[h] = act && spec.allowT1 ? Math.min(t1[h], remoteLocal) : 0;
            intrLim[h] = act && spec.allowT2 ? t2[h] : 0;
            mustLocal[h] = L - relocLim[h] - intrLim[h];
            gasPrice[h] = (R.henry_hub[r] * M_G[h] + meta.gas_adder) * site.gasMult;
            gridPrice[h] = R.price[r] * M_W[h] * site.priceMult + meta.grid_adder;
            gridCo2[h] = meta.grid_co2 * M_C[h] * site.gridCo2Mult;
            windCf[h] = Math.min(1, R.wind_cf[r] * site.windMult);
            solarCf[h] = Math.min(1, R.solar_cf[r] * site.solarMult);
            for (const k in gf) gf[k][h] = (1 - (spec.heat && SUMMER_PM[r] ? RULES.heatDerate[k] : 0)) * (1 - outage);
        }
        // battery "peak" hours: the 8 priciest hours of each 24-hour block
        const peak = new Uint8Array(N);
        const tmp = new Float64Array(24);
        for (let d = 0; d < N / 24; d++) {
            for (let i = 0; i < 24; i++) tmp[i] = gridPrice[d * 24 + i];
            const thr = Float64Array.from(tmp).sort()[16];
            for (let i = 0; i < 24; i++) peak[d * 24 + i] = tmp[i] >= thr ? 1 : 0;
        }
        const sc = { spec, site, scale, load, t1, t2, cap, ordinary, stress, evIdx, relocLim, intrLim, mustLocal,
            gasPrice, gridPrice, gridCo2, windCf, solarCf, gf, peak, remoteCo2Factor: M_C, remoteCo2Base: meta.grid_co2 * site.gridCo2Mult };
        if (scCache.size > 24) scCache.delete(scCache.keys().next().value);
        scCache.set(key, sc);
        return sc;
    }

    /* -------------------------------------------------------------- dispatch.py */

    function floors(stress, mustLocal, cap, gasFirm, emax, eta) {
        const adeq = new Float64Array(N), econ = new Float64Array(N);
        let future = 0;
        for (let t = N - 1; t >= 0; t--) {
            if (stress[t]) {
                adeq[t] = future / eta;
                const need = mustLocal[t] - cap[t] - gasFirm[t];
                if (need > 0) future += need;
            } else future = 0;
        }
        let nextReq = 0, dist = 99999;
        for (let t = N - 1; t >= 0; t--) {
            if (stress[t]) {
                let need = mustLocal[t] - cap[t] - gasFirm[t];
                if (need < 0) need = 0;
                nextReq = adeq[t] + need / eta;
                dist = 0;
                econ[t] = adeq[t];
            } else {
                dist++;
                if (dist <= RULES.holdHours && nextReq > 0) econ[t] = nextReq;
                else { if (dist > RULES.holdHours) nextReq = 0; econ[t] = 0; }
            }
        }
        for (let t = 0; t < N; t++) { if (econ[t] > emax) econ[t] = emax; if (adeq[t] > emax) adeq[t] = emax; }
        return [econ, adeq];
    }

    function resMw(sc, caps) {
        const out = {};
        for (const k of IDS) {
            const first = Math.max(sc.spec.start, CATALOG[k].avail);
            out[k] = { mw: caps[k] || 0, firstHour: first * HPM };
        }
        return out;
    }

    function fillAvail(out, r, shape) {
        if (!r.mw) { out.fill(0); return; }
        out.fill(0, 0, r.firstHour);
        for (let h = r.firstHour; h < N; h++) out[h] = shape ? r.mw * shape[h] : r.mw;
    }

    let ws = null;
    const WS_KEYS = ['windAv', 'solarAv', 'nucAv', 'gtAv', 'geAv', 'fcAv', 'battMw', 'grid', 'reloc', 'intr', 'wind', 'solar', 'nuc', 'chg', 'dis', 'soc', 'gt', 'ge', 'fc', 'unmet'];
    function newWorkspace() {
        const w = {};
        for (const k of WS_KEYS) w[k] = new Float64Array(N);
        return w;
    }

    function dispatch(caps, sc, lam = 0, keep = false) {
        const eta = RULES.eta;
        const mw = resMw(sc, caps);
        // reuse one workspace for search evaluations (allocation dominates otherwise); fresh arrays when the caller keeps flows
        const W = keep ? newWorkspace() : (ws || (ws = newWorkspace()));
        const { windAv, solarAv, nucAv, gtAv, geAv, fcAv, battMw } = W;
        fillAvail(windAv, mw.wind, sc.windCf);
        fillAvail(solarAv, mw.utility_solar, sc.solarCf);
        fillAvail(nucAv, mw.nuclear, null);
        fillAvail(gtAv, mw.gas_turbine, sc.gf.gas_turbine);
        fillAvail(geAv, mw.gas_engine, sc.gf.gas_engine);
        fillAvail(fcAv, mw.fuel_cell, sc.gf.fuel_cell);
        fillAvail(battMw, mw.battery_4h, null);
        const bcap = caps.battery_4h || 0;
        const emax = bcap * RULES.battHours;
        const budget = new Float64Array(10);
        let fe, fa, refill;
        if (bcap > 0) {
            for (let h = 0; h < N; h++) if (battMw[h] > 0) budget[YEAR[h]] += 1;
            for (let y = 0; y < 10; y++) budget[y] = (bcap * RULES.battHours * RULES.battCycles * budget[y]) / HPY;
            const firm = new Float64Array(N);
            for (let h = 0; h < N; h++) firm[h] = gtAv[h] + geAv[h] + fcAv[h];
            [fe, fa] = floors(sc.stress, sc.mustLocal, sc.cap, firm, emax, eta);
            const cs = new Float64Array(N + 1);
            for (let h = 0; h < N; h++) {
                let pot = Math.min(sc.cap[h], windAv[h] + solarAv[h] + nucAv[h]) - sc.load[h];
                if (pot < 0) pot = 0;
                cs[h + 1] = cs[h] + Math.min(pot, battMw[h]) * eta;
            }
            refill = new Float64Array(N);
            for (let h = 0; h < N; h++) refill[h] = cs[Math.min(h + 25, N)] - cs[h + 1];
        } else {
            fe = fa = refill = new Float64Array(N);
        }
        const gk = ['gas_turbine', 'gas_engine', 'fuel_cell'].map(k => CATALOG[k]);
        const vom = gk.map(g => g.price), hr = gk.map(g => g.hr), co2f = gk.map(g => g.co2);

        const o = {
            grid: W.grid, reloc: W.reloc, intr: W.intr, wind: W.wind, solar: W.solar, nuc: W.nuc, chg: W.chg, dis: W.dis,
            soc: W.soc, gt: W.gt, ge: W.ge, fc: W.fc, unmet: W.unmet,
        };
        const { load, cap, relocLim, intrLim, gridPrice: price, gasPrice: gasp, gridCo2: gco2, peak: dischargeOk } = sc;
        const drain = RULES.drainHours;
        let soc = 0, curY = 0, used = 0;
        const mc = new Float64Array(4), rem = new Float64Array(4), al = new Float64Array(4), order = new Int32Array(4);
        for (let t = 0; t < N; t++) {
            const y = YEAR[t];
            if (y !== curY) { curY = y; used = 0; }
            const L = load[t];
            const bp = battMw[t];
            if (L <= 1e-12) {
                o.grid[t] = o.reloc[t] = o.intr[t] = o.wind[t] = o.solar[t] = o.nuc[t] = 0;
                o.chg[t] = o.dis[t] = o.gt[t] = o.ge[t] = o.fc[t] = o.unmet[t] = 0;
                o.soc[t] = soc;
                continue;
            }
            const capT = cap[t];
            const inDrain = N - t <= drain;
            const feT = inDrain ? 0 : fe[t];
            const faT = inDrain ? 0 : fa[t];
            let cycleLeft = (budget[y] - used) * eta;
            if (cycleLeft < 0) cycleLeft = 0;
            let demand = L, merchant = 0, offsite = 0, dis = 0, chg = 0;
            if (inDrain && bp > 0 && soc > 0) {
                let d = soc * eta;
                if (bp < d) d = bp;
                if (demand < d) d = demand;
                dis = d; demand -= d;
            }
            if (price[t] < 0) {
                const take = demand < capT ? demand : capT;
                merchant = take; offsite = take; demand -= take;
            }
            let room = capT - offsite;
            let take = Math.min(demand, windAv[t], room);
            let wd = take > 0 ? take : 0;
            demand -= wd; room -= wd; offsite += wd;
            take = Math.min(demand, solarAv[t], room);
            let sd = take > 0 ? take : 0;
            demand -= sd; room -= sd; offsite += sd;
            take = Math.min(demand, nucAv[t], room);
            let nd = take > 0 ? take : 0;
            demand -= nd; offsite += nd;

            const gp = gasp[t];
            mc[0] = price[t] + lam * gco2[t]; rem[0] = capT > offsite ? capT - offsite : 0;
            mc[1] = vom[0] + hr[0] * gp + lam * co2f[0]; rem[1] = gtAv[t];
            mc[2] = vom[1] + hr[1] * gp + lam * co2f[1]; rem[2] = geAv[t];
            mc[3] = vom[2] + hr[2] * gp + lam * co2f[2]; rem[3] = fcAv[t];
            for (let j = 0; j < 4; j++) { order[j] = j; al[j] = 0; }
            for (let a = 1; a < 4; a++) {
                const key = order[a];
                let b = a - 1;
                while (b >= 0 && mc[order[b]] > mc[key]) { order[b + 1] = order[b]; b--; }
                order[b + 1] = key;
            }
            for (let k = 0; k < 4; k++) {
                const j = order[k];
                if (demand <= 1e-12) break;
                const tk = demand < rem[j] ? demand : rem[j];
                if (tk > 0) { al[j] = tk; demand -= tk; }
            }
            if (!inDrain && bp > 0) {
                if (demand > 1e-12) {
                    let roomE = (soc - faT) * eta;
                    if (roomE < 0) roomE = 0;
                    const d1 = Math.min(demand, bp, roomE, cycleLeft);
                    if (d1 > 0) { dis += d1; demand -= d1; }
                }
                let floorUse = feT;
                if (!dischargeOk[t]) {
                    floorUse = emax - refill[t];
                    if (floorUse < feT) floorUse = feT;
                }
                if (dis < bp - 1e-12 && soc > floorUse + 1e-9) {
                    const roomE = (soc - floorUse) * eta - dis;
                    const d2 = Math.min(bp - dis, roomE, cycleLeft - dis);
                    if (d2 > 1e-12) {
                        let shaved = 0;
                        for (let k = 3; k >= 0; k--) {
                            const j = order[k];
                            if (mc[j] <= 0) continue;
                            const cut = al[j] < d2 - shaved ? al[j] : d2 - shaved;
                            if (cut > 0) { al[j] -= cut; shaved += cut; }
                            if (shaved >= d2 - 1e-12) break;
                        }
                        dis += shaved;
                    }
                }
            }
            merchant += al[0]; offsite += al[0];
            let reloc = 0, intr = 0;
            if (demand > 1e-12) { const lim = relocLim[t]; const tk = demand < lim ? demand : lim; reloc = tk; demand -= tk; }
            if (demand > 1e-12) { const lim = intrLim[t]; const tk = demand < lim ? demand : lim; intr = tk; demand -= tk; }
            o.unmet[t] = demand > 0 ? demand : 0;
            if (!inDrain && bp > 0 && dis <= 1e-12 && demand <= 1e-8) {
                const left = windAv[t] - wd + (solarAv[t] - sd) + (nucAv[t] - nd);
                const head = capT - offsite;
                const socRoom = (emax - soc) / eta;
                const ch = Math.min(left, head, socRoom, bp);
                if (ch > 1e-12) {
                    let add = Math.min(windAv[t] - wd, ch); wd += add;
                    let r = ch - add;
                    add = Math.min(solarAv[t] - sd, r); sd += add; r -= add;
                    add = Math.min(nucAv[t] - nd, r); nd += add;
                    chg = ch; offsite += ch;
                }
            }
            soc = soc + eta * chg - dis / eta;
            if (soc < 0 && soc > -1e-9) soc = 0;
            used += dis / eta;
            o.grid[t] = merchant; o.reloc[t] = reloc; o.intr[t] = intr; o.wind[t] = wd; o.solar[t] = sd; o.nuc[t] = nd;
            o.chg[t] = chg; o.dis[t] = dis; o.soc[t] = soc; o.gt[t] = al[1]; o.ge[t] = al[2]; o.fc[t] = al[3];
        }
        return { flows: o, mw, avail: { wind: windAv, solar: solarAv, nuc: nucAv, gt: gtAv, ge: geAv, fc: fcAv, batt: battMw } };
    }

    /* -------------------------------------------------------------- model.account() */

    function annualCharge(k) {
        const c = CATALOG[k];
        return 1000 * (c.capex * crf(RULES.discount, c.life) + c.fom);
    }

    function account(caps, sc, d) {
        const { flows: F, mw } = d;
        const site = sc.site;
        const prof = { utility_solar: sc.solarCf, wind: sc.windCf };
        const gen = { utility_solar: F.solar, wind: F.wind, nuclear: F.nuc, gas_turbine: F.gt, gas_engine: F.ge, fuel_cell: F.fc };
        let fixedT = 0, payT = 0, fuelT = 0, co2Local = 0;
        const ledger = {};
        for (const k of IDS) {
            const c = CATALOG[k];
            const m = mw[k].mw, h0 = mw[k].firstHour;
            const hours = Math.max(0, N - h0);
            const fixed = (m * hours * annualCharge(k)) / HPY;
            let pay = 0, fuel = 0, gsum = 0;
            if (k !== 'battery_4h') {
                const g = gen[k];
                const price = site.prices[k] ?? c.price;
                if (c.basis === 'available') {
                    let billed = 0;
                    if (k === 'nuclear') billed = m * hours;
                    else { const p = prof[k]; for (let h = h0; h < N; h++) billed += p[h]; billed *= m; }
                    pay = billed * price;
                } else {
                    for (let h = 0; h < N; h++) gsum += g[h];
                    pay = gsum * price;
                }
                if (c.hr) {
                    let s = 0;
                    for (let h = 0; h < N; h++) s += g[h] * sc.gasPrice[h];
                    fuel = s * c.hr;
                }
                if (c.co2) co2Local += gsum * c.co2;
            }
            fixedT += fixed; payT += pay; fuelT += fuel;
            ledger[k] = { fixed, pay, fuel, total: fixed + pay + fuel };
        }
        let merchantCost = 0, merchantMwh = 0, reloc = 0, intr = 0, requested = 0, co2Remote = 0, unmet = 0, unmetHours = 0;
        let cleanMwh = 0, chgSum = 0, disSum = 0, windS = 0, solarS = 0, nucS = 0, gtS = 0, geS = 0, fcS = 0, maxImport = 0;
        const remoteBase = sc.remoteCo2Base;
        for (let h = 0; h < N; h++) {
            merchantCost += F.grid[h] * sc.gridPrice[h];
            co2Local += F.grid[h] * sc.gridCo2[h];
            merchantMwh += F.grid[h];
            reloc += F.reloc[h]; intr += F.intr[h];
            co2Remote += F.reloc[h] * RULES.remoteMult * remoteBase * sc.remoteCo2Factor[h];
            requested += sc.load[h];
            unmet += F.unmet[h];
            if (F.unmet[h] > 1e-4) unmetHours++;
            windS += F.wind[h]; solarS += F.solar[h]; nucS += F.nuc[h]; chgSum += F.chg[h]; disSum += F.dis[h];
            gtS += F.gt[h]; geS += F.ge[h]; fcS += F.fc[h];
            const imp = F.grid[h] + F.solar[h] + F.wind[h] + F.nuc[h];
            if (imp > maxImport) maxImport = imp;
        }
        cleanMwh = windS + solarS + nucS - chgSum + disSum;
        const localCost = fixedT + payT + fuelT + merchantCost;
        const relocCost = reloc * RULES.relocPrice, intrCost = intr * RULES.intrPrice;
        const served = requested - reloc - intr;
        const remoteMwh = reloc * RULES.remoteMult;
        const total = localCost + relocCost + intrCost;
        const clTot = Math.max(windS + solarS + nucS, 1e-9);
        const mix = {
            utility_solar: solarS - (chgSum * solarS) / clTot, wind: windS - (chgSum * windS) / clTot, nuclear: nucS - (chgSum * nucS) / clTot,
            battery_4h: disSum, gas_turbine: gtS, gas_engine: geS, fuel_cell: fcS, merchant: merchantMwh,
        };
        const socEnd = F.soc[N - 1];
        const fullMonth = sc.spec.start + RULES.ramp;
        return {
            caps: { ...caps }, start: sc.spec.start, full: fullMonth,
            requested, served, reloc, intr, unmet, unmetHours, remoteMwh,
            total, localCost, relocCost, intrCost, fixed: fixedT, payments: payT, fuel: fuelT, merchantCost,
            usd_mwh: requested > 0 ? total / requested : null,
            co2_t: co2Local + co2Remote, co2Local, co2Remote,
            kg: served + remoteMwh > 0 ? (1000 * (co2Local + co2Remote)) / (served + remoteMwh) : null,
            clean: served > 0 ? cleanMwh / served : null,
            merchant: served > 0 ? merchantMwh / served : null, merchantMwh,
            mix, ledger, land: landUsed(caps), maxImport, socEnd,
            feasible: unmet < 1e-3 && unmetHours === 0 && Math.abs(socEnd) < 1e-5,
        };
    }

    function evaluate(caps, spec, lam = 0, keep = false) {
        const full = {};
        for (const k of IDS) full[k] = +(caps[k] || 0);
        const sc = buildScenario(spec);
        const d = dispatch(full, sc, lam, keep);
        const m = account(full, sc, d);
        m.lam = lam;
        if (keep) { m.flows = d.flows; m.avail = d.avail; m.sc = sc; }
        return m;
    }

    return { meta, R, REF, MONTH, YEAR, buildScenario, dispatch, account, evaluate, annualCharge };
}

/* ------------------------------------------------------------------ helpers shared by UI + worker */

export async function loadEngine(base = './data/') {
    const [meta, buf] = await Promise.all([
        fetch(base + 'meta.json').then(r => r.json()),
        fetch(base + 'reference.bin').then(r => r.arrayBuffer()),
    ]);
    return createEngine(meta, buf);
}
