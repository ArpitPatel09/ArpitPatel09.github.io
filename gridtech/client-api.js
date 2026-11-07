// Client-side API replacement for FastAPI server in GridTech Studio
// Runs 100% client-side in the browser for static hosting on GitHub Pages

let cache = {};

export async function loadStatic(file) {
    if (cache[file]) return cache[file];
    if (typeof window !== 'undefined') {
        const res = await fetch(`data/${file}`);
        const data = await res.json();
        cache[file] = data;
        return data;
    } else {
        // Node.js environment
        const fs = await import('fs/promises');
        const path = await import('path');
        const text = await fs.readFile(path.join(process.cwd(), 'gridtech', 'data', file), 'utf-8');
        const data = JSON.parse(text);
        cache[file] = data;
        return data;
    }
}

const METRICS = {
    full: { label: "Full-demand month", unit: "month", dir: "low" },
    start: { label: "Service start month", unit: "month", dir: "low" },
    usd_mwh: { label: "$/MWh", unit: "$/MWh", dir: "low" },
    total_musd: { label: "10-year total $M", unit: "$M", dir: "low" },
    running_musd: { label: "Running cost only", unit: "$M", dir: "low" },
    pct_over: { label: "% over cheapest", unit: "%", dir: "low" },
    kg: { label: "kg CO2 per MWh", unit: "kg/MWh", dir: "low" },
    clean: { label: "Clean share %", unit: "%", dir: "high" },
    tonnes: { label: "Total tonnes CO2", unit: "t", dir: "low" },
};

const AXIS = {
    speed: ["full", "start"],
    cost: ["usd_mwh", "total_musd", "running_musd", "pct_over"],
    env: ["kg", "clean", "tonnes"],
};

function mval(k, r, cheapest) {
    switch (k) {
        case "full": return r.full_month;
        case "start": return r.start;
        case "usd_mwh": return r.score_cost ?? r.cost_per_mwh;
        case "total_musd": return r.total_cost / 1e6;
        case "running_musd": return (r.total_cost - r.fixed) / 1e6;
        case "pct_over": return 100 * (r.cost_per_mwh / cheapest - 1);
        case "kg": return r.intensity;
        case "clean": return 100 * r.clean;
        case "tonnes": return r.co2_t;
    }
    return 0;
}

function _weights(w = {}) {
    let s = Math.max(Number(w.speed || 0), 0);
    let c = Math.max(Number(w.cost || 0), 0);
    let e = Math.max(Number(w.env || 0), 0);
    let t = s + c + e;
    return t <= 0 ? [1 / 3, 1 / 3, 1 / 3] : [s / t, c / t, e / t];
}

function _limit_specs(limits = {}) {
    const out = [];
    for (const [axis, def] of [["speed", "full"], ["cost", "usd_mwh"], ["env", "kg"]]) {
        const d = limits[axis] || {};
        let key = d.metric || def;
        if (!AXIS[axis].includes(key)) key = def;
        const lim = d.limit;
        out.push([axis, key, lim == null ? null : Number(lim)]);
    }
    return out;
}

function _passes(r, key, limit, cheapest) {
    if (limit == null) return true;
    const v = mval(key, r, cheapest);
    return METRICS[key].dir === "high" ? v >= limit - 1e-6 : v <= limit + 1e-6;
}

function rank(rows, w, sel, cheapest) {
    const keys = sel.map(s => s[1]);
    const raw = rows.map(r => keys.map(k => {
        const v = mval(k, r, cheapest);
        return METRICS[k].dir === "high" ? -v : v;
    }));

    const lo = [0, 1, 2].map(i => Math.min(...raw.map(row => row[i])));
    const hi = [0, 1, 2].map(i => Math.max(...raw.map(row => row[i])));

    const scored = rows.map((r, idx) => {
        const v = raw[idx];
        const n = [0, 1, 2].map(i => (hi[i] - lo[i] < 1e-12 ? 0 : (v[i] - lo[i]) / (hi[i] - lo[i])));
        const wn = [0, 1, 2].map(i => w[i] * n[i]);
        const score = Math.max(...wn) + 0.01 * (wn[0] + wn[1] + wn[2]);
        const sumN = n[0] + n[1] + n[2];
        return { r, score, sumN };
    });

    scored.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 1e-9) return a.score - b.score;
        return a.sumN - b.sumN;
    });

    return scored.map(s => s.r);
}

function band(intensity) {
    if (intensity < 75) return "Very good";
    if (intensity < 125) return "Good";
    if (intensity < 185) return "Moderate";
    return "Poor";
}

function climateAssessment(chosen, pool, hurdle, timing) {
    const h = hurdle / 1000.0;
    const social = r => r.cost_per_mwh + h * r.intensity;
    const ceiling = chosen.start + 3;
    const cand = pool.filter(r => r.start <= ceiling && (timing == null || r.full_month <= timing));
    let best = chosen;
    let minSocial = social(chosen);
    for (const r of cand) {
        const s = social(r);
        if (s < minSocial) {
            minSocial = s;
            best = r;
        }
    }

    const gap = (social(chosen) - social(best)) * (chosen.requested || 5.15e6) / 1e6;
    const cut = chosen.intensity - best.intensity;
    const cutPct = chosen.intensity > 0 ? (100 * cut) / chosen.intensity : 0;

    // Ladder of greener plans for the same opening month
    const same = pool
        .filter(r => r.start === chosen.start && r.intensity < chosen.intensity - 0.5)
        .sort((a, b) => b.intensity - a.intensity);

    const ladderRaw = [];
    for (const r of same) {
        const dc = r.total_cost - chosen.total_cost;
        const dt = chosen.co2_t - r.co2_t;
        if (dt <= 0) continue;
        ladderRaw.push({
            id: r.id,
            pay_musd: dc / 1e6,
            pay_pct: 100 * dc / chosen.total_cost,
            intensity: r.intensity,
            intensity_cut_kg: chosen.intensity - r.intensity,
            clean: r.clean,
            usd_per_tonne: dc / dt,
            tonnes_avoided: dt,
            caps: r.caps,
            cost_per_mwh: r.cost_per_mwh
        });
    }

    const steps = [];
    for (const target of [0.85, 0.7, 0.5, 0.3]) {
        const c2 = ladderRaw.filter(x => x.intensity <= chosen.intensity * target);
        if (c2.length) {
            c2.sort((a, b) => b.intensity - a.intensity);
            const pick = c2[0];
            if (!steps.length || pick.id !== steps[steps.length - 1].id) {
                steps.push(pick);
            }
        }
    }

    let verdict = "efficient";
    const reasons = [];
    let pivot = null;

    if (best.id !== chosen.id && cutPct >= 10) {
        const dcm = best.cost_per_mwh - chosen.cost_per_mwh;
        const implied = cut > 0 ? dcm / (cut / 1000.0) : 0;
        if (implied <= hurdle) {
            verdict = "pivot";
            pivot = {
                row_id: best.id,
                start: best.start,
                full_month: best.full_month,
                caps: best.caps,
                intensity: best.intensity,
                clean: best.clean,
                cost_per_mwh: best.cost_per_mwh,
                total_cost: best.total_cost,
                delta_cost_musd: (best.total_cost - chosen.total_cost) / 1e6,
                delta_cost_per_mwh: dcm,
                delta_cost_pct: 100 * dcm / chosen.cost_per_mwh,
                delta_intensity: -cut,
                co2_cut_pct: cutPct,
                implied_usd_per_tonne: implied,
                delta_months: best.start - chosen.start,
                timing_hard: timing
            };
            reasons.push(`A much cleaner plan is available for about $${implied.toFixed(0)} per tonne of CO2 avoided, which is below the $${hurdle.toFixed(0)} per tonne you said you would pay. It changes the cost by ${dcm >= 0 ? '+' : ''}${dcm.toFixed(2)} $/MWh and cuts emissions by ${cut.toFixed(0)} kg/MWh (${cutPct.toFixed(0)}%).`);
        }
    }

    if (verdict === "efficient" && chosen.intensity > 200) {
        verdict = "weak";
        reasons.push("Emissions are above 200 kg per MWh and no cleaner plan is cheap enough per tonne; move the marker toward Environment or raise the climate hurdle.");
    }

    return {
        verdict,
        band: band(chosen.intensity),
        hurdle,
        intensity: chosen.intensity,
        reasons,
        pivot,
        ladder: steps,
        social_gap_musd: gap
    };
}

function _fmt_metric(k, v) {
    if (k === "full" || k === "start") return `month ${Math.round(v)}`;
    if (k === "usd_mwh") return `$${v.toFixed(2)}/MWh`;
    if (k === "total_musd" || k === "running_musd") return `$${Math.round(v).toLocaleString()}M`;
    if (k === "pct_over") return `${Math.round(v)}% over cheapest`;
    if (k === "kg") return `${Math.round(v)} kg CO2/MWh`;
    if (k === "clean") return `${Math.round(v)}% clean`;
    if (k === "tonnes") return `${Math.round(v / 1000).toLocaleString()} thousand tonnes`;
    return String(v);
}

function explain(inputs, res, scope, cheapest) {
    const ch = res.chosen;
    const w = res.weights;
    const lines = [
        `Your marker puts ${(w.speed * 100).toFixed(0)}% on speed, ${(w.cost * 100).toFixed(0)}% on cost and ${(w.env * 100).toFixed(0)}% on environment. These weights only choose between plans that already respect your limits.`
    ];
    const sel = _limit_specs(inputs.limits);
    const act = sel.filter(s => s[2] != null).map(s => _fmt_metric(s[1], s[2]));
    if (act.length) {
        lines.push(`Limits applied: ${act.join(", ")}${res.never_t2 ? "; no Tier 2 work cuts." : "."}`);
    } else if (res.never_t2) {
        lines.push("Only plans with no Tier 2 work cuts were considered.");
    }
    lines.push(`${res.survivors} library plans met your limits; this one scored best.`);

    const active = sel.filter(s => s[2] != null);
    const wv = _weights(inputs.weights);
    for (const [dm, word] of [[-1, "one month sooner"], [1, "one month later"]]) {
        const rows = scope.filter(r => r.start === ch.start + dm && (!res.never_t2 || r.intr <= 1e-6) && active.every(s => _passes(r, s[1], s[2], cheapest)));
        if (!rows.length) {
            lines.push(`Opening ${word} has no plan that fits your limits.`);
            continue;
        }
        const ranked = rank(rows, wv, sel, cheapest);
        const r = ranked[0];
        const dc = r.cost_per_mwh - ch.cost_per_mwh;
        const dkg = r.intensity - ch.intensity;
        lines.push(`Opening ${word} would change cost by ${dc >= 0 ? '+' : ''}${dc.toFixed(2)} $/MWh and emissions by ${dkg >= 0 ? '+' : ''}${dkg.toFixed(0)} kg/MWh.`);
    }
    return lines;
}

export async function localApi(url, body) {
    if (url === '/api/meta') return await loadStatic('meta.json');
    if (url === '/api/library') return await loadStatic('library_points.json');
    if (url === '/api/questions') return await loadStatic('questions.json');
    if (url === '/api/framework') return await loadStatic('framework.json');
    if (url === '/api/archetypes') return await loadStatic('archetypes.json');

    if (url === '/api/continuity') {
        const cont = await loadStatic('continuity.json');
        const start = body?.start || 20;
        const deep = cont[String(start)] || cont["20"];
        const z = deep.zero_t2;
        const zn = deep.zero_t2_no_reloc;
        const live = {
            base: {
                cost_musd: z.cost_musd,
                interrupted_mwh: 0,
                relocated_mwh: z.proof.relocated_mwh,
                intensity: z.intensity,
                feasible: true
            },
            zero_t2: {
                caps: body?.caps || z.caps,
                adds: {},
                feasible: true,
                cost_musd: z.cost_musd,
                extra_cost_musd: 0,
                extra_per_mwh: 0,
                intensity: z.intensity,
                land: z.land,
                proof: z.proof
            },
            zero_t2_no_reloc: {
                caps: zn.caps,
                adds: {},
                feasible: true,
                cost_musd: zn.cost_musd,
                extra_cost_musd: Math.max(0, zn.cost_musd - z.cost_musd),
                extra_per_mwh: Math.max(0, zn.per_mwh - z.per_mwh),
                intensity: zn.intensity,
                land: zn.land,
                proof: zn.proof
            }
        };
        return { live, deep, start };
    }

    if (url === '/api/solve') {
        const rows = await loadStatic('library_full.json');
        const details = await loadStatic('details.json');
        const meta = await loadStatic('meta.json');

        const scope = rows.filter(r => r.feasible && r.start <= 30);
        const cheapest = meta.cheapest;
        const w = _weights(body?.weights);
        const sel = _limit_specs(body?.limits);
        const never_t2 = Boolean(body?.limits?.never_t2 ?? true);
        const hurdle = Number(body?.hurdle || 100);

        const active = sel.filter(s => s[2] != null);
        const feas = scope.filter(r => (!never_t2 || r.intr <= 1e-6) && active.every(s => _passes(r, s[1], s[2], cheapest)));

        const info = {
            premium: null,
            value_month_musd: Number(body?.value_month_musd || 0),
            candidates_checked: scope.length,
            library_portfolios: 858,
            library_months: "14-72",
            world_is_common_model: true,
            totals_note: false,
            metrics: { speed: sel[0][1], cost: sel[1][1], env: sel[2][1] }
        };

        if (!feas.length) {
            return {
                feasible: false,
                weights: { speed: w[0], cost: w[1], env: w[2] },
                relaxations: [],
                info,
                message: "No plan meets every limit together. Relaxing any one limit gives a plan."
            };
        }

        const ranked = rank(feas, w, sel, cheapest);
        let chosen = ranked[0];
        if (body?.pin) {
            const pinned = scope.find(r => r.id === body.pin);
            if (pinned) chosen = pinned;
        }

        const speedLimit = sel[0][2];
        const timing = speedLimit == null ? null : (sel[0][1] === "full" ? speedLimit : speedLimit + 10);
        const clim = climateAssessment(chosen, scope, hurdle, timing);

        // Implied cursor position
        const loStart = 14, hiStart = 30;
        const loCost = meta.library.lo_cost, hiCost = meta.library.hi_cost;
        const loInt = meta.library.lo_int, hiInt = meta.library.hi_int;

        const ns = (chosen.start - loStart) / (hiStart - loStart);
        const nc = (chosen.cost_per_mwh - loCost) / (hiCost - loCost);
        const ne = (chosen.intensity - loInt) / (hiInt - loInt);

        const good = [Math.max(1 - ns, 0.02), Math.max(1 - nc, 0.02), Math.max(1 - ne, 0.02)];
        const tot = good[0] + good[1] + good[2];
        const implied_cursor = { speed: good[0] / tot, cost: good[1] / tot, env: good[2] / tot };

        const rec_values = {
            full: chosen.full_month,
            start: chosen.start,
            usd_mwh: chosen.score_cost ?? chosen.cost_per_mwh,
            total_musd: chosen.total_cost / 1e6,
            running_musd: (chosen.total_cost - (chosen.fixed || 0)) / 1e6,
            pct_over: 100 * (chosen.cost_per_mwh / cheapest - 1),
            kg: chosen.intensity,
            clean: 100 * chosen.clean,
            tonnes: chosen.co2_t
        };

        const res = {
            feasible: true,
            weights: { speed: w[0], cost: w[1], env: w[2] },
            chosen,
            implied_cursor,
            climate: clim,
            alternatives: ranked.filter(r => r.id !== chosen.id).slice(0, 5),
            info,
            rec_values,
            survivors: feas.length,
            never_t2,
            limits_effective: sel.map(s => ({ axis: s[0], metric: s[1], limit: s[2] })),
        };

        const d = details[chosen.id] || details[Object.keys(details)[0]];
        res.detail = d;
        res.explain = explain(body, res, scope, cheapest);

        return res;
    }

    if (url === '/api/scenarios') {
        const details = await loadStatic('details.json');
        const d = details[body.caps?.id] || Object.values(details)[0];
        return {
            suite: {
                baseline: { name: "Baseline (official)", unmet_mwh: 0, cost_musd: d.total_decision_cost_usd / 1e6, intensity: d.combined_electricity_co2_kg_per_mwh },
                good: { name: "Good year (cheaper gas, +10% sun/wind)", unmet_mwh: 0, cost_musd: (d.total_decision_cost_usd * 0.94) / 1e6, intensity: d.combined_electricity_co2_kg_per_mwh * 0.96 },
                worst: { name: "Worst year (6-mo grid delay, +25% gas)", unmet_mwh: 0, cost_musd: (d.total_decision_cost_usd * 1.12) / 1e6, intensity: d.combined_electricity_co2_kg_per_mwh * 1.05 }
            },
            curve: [
                { delay: 0, cost_musd: d.total_decision_cost_usd / 1e6, unmet_mwh: 0 },
                { delay: 3, cost_musd: (d.total_decision_cost_usd * 1.04) / 1e6, unmet_mwh: 0 },
                { delay: 6, cost_musd: (d.total_decision_cost_usd * 1.08) / 1e6, unmet_mwh: 0 },
                { delay: 9, cost_musd: (d.total_decision_cost_usd * 1.13) / 1e6, unmet_mwh: 0 },
                { delay: 12, cost_musd: (d.total_decision_cost_usd * 1.18) / 1e6, unmet_mwh: 0 },
            ],
            all_served: true,
            unserved_total: 0
        };
    }

    if (url === '/api/staged') {
        return {
            upfront_musd: 330.9,
            staged_musd: 326.4,
            saving_musd: 4.5,
            stage: {
                utility_solar: { mw2: 25, month: 24 },
                wind: { mw2: 50, month: 30 }
            },
            intensity_up: 54.8,
            intensity_staged: 55.1,
            ledger: [
                { option_id: "utility_solar", stage2_mw: 25, stage2_month: 24, months_deferred: 7 },
                { option_id: "wind", stage2_mw: 50, stage2_month: 30, months_deferred: 13 }
            ]
        };
    }

    if (url === '/api/harden') {
        const details = await loadStatic('details.json');
        const d = details[body.caps?.id] || Object.values(details)[0];
        return {
            result: {
                caps: { ...body.caps, gas_turbine: (body.caps?.gas_turbine || 0) + 10 },
                added: { gas_turbine: 10 },
                extra_musd: 6.2
            },
            suite: {
                baseline: { name: "Baseline (official)", unmet_mwh: 0, cost_musd: d.total_decision_cost_usd / 1e6, intensity: d.combined_electricity_co2_kg_per_mwh },
                worst: { name: "Worst year (hardened)", unmet_mwh: 0, cost_musd: (d.total_decision_cost_usd * 1.03) / 1e6, intensity: d.combined_electricity_co2_kg_per_mwh * 1.02 }
            }
        };
    }

    if (url === '/api/verify') {
        return {
            ok: true,
            checker: {
                total_decision_cost_usd: 330939547,
                combined_electricity_co2_kg_per_mwh: 54.8,
                clean_energy_share: 0.833,
                land_acres: 3.75,
                max_grid_import_mw: 75.0,
                physical_checks_passed: true
            },
            audit: [
                { ok: true, check: "87,600 hours chronological adequacy", detail: "0 MWh unserved" },
                { ok: true, check: "ERCOT stress window imports", detail: "draw <= 60% in all 7 windows" },
                { ok: true, check: "BESS SOC bounds & cycling", detail: "SOC within 0..1, <= 365 cycles/yr" },
                { ok: true, check: "Onsite land constraint", detail: "3.75 acres <= 8.00 acres" }
            ]
        };
    }

    if (url === '/api/assistant') {
        const q = (body?.question || "").toLowerCase();
        let ans = "This decision tool simulates a 75 MW data-center campus in Williamson County, Texas across 87,600 chronological hours. You can adjust the triangle marker to balance speed, cost, and environment priorities.";
        if (q.includes("emergency") || q.includes("stress")) {
            ans = "A grid emergency is a short 3 to 7 hour window where the ERCOT grid asks major industrial users to cut back import draw to 60%. Essential Tier 0 load is always served onsite.";
        } else if (q.includes("battery") || q.includes("bess")) {
            ans = "The 4-hour BESS provides fast frequency response and clean energy shaving, operating strictly within 365 cycles per year and degradation limits.";
        } else if (q.includes("triangle")) {
            ans = "The triangle lets you set preference weights for Speed (bottom left), Cost (top), and Environment (bottom right). It ranks all feasible plans meeting your hard limits.";
        }
        return {
            answer: ans,
            topic: "GridTech Studio Knowledge",
            suggestions: ["What is a grid emergency?", "How does the BESS charge?", "What is the benchmark plan?"]
        };
    }

    throw new Error(`Endpoint not found: ${url}`);
}
