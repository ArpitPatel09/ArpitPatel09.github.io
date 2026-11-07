/* GridTech Studio 3D: wires the hourly engine, the recommender and the 3D world together. */
import { loadEngine, IDS, CATALOG, RULES, N, HPM, HPY, defaultSite, isBenchmarkSite, limitsFor, landUsed } from './engine.js';
import { libraryRows, recommend, seedsFor, candidateMonths } from './optimizer.js';
import { World, VIEWS } from './world/world.js';
import { drawSpark, drawPareto } from './charts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const EMBED = params.has('embed');
const STILL = params.has('still'); // poster renders: fixed hour, no motion
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const RES = [
    { id: 'utility_solar', key: 'solar', label: 'Solar', color: '#ffc53d', slots: 30 },
    { id: 'wind', key: 'wind', label: 'Wind', color: '#4fd6ff', slots: 40 },
    { id: 'nuclear', key: 'nuclear', label: 'Nuclear', color: '#b28dff', slots: 1 },
    { id: 'gas_turbine', key: 'turbine', label: 'Gas turbine', color: '#ff8a3d', slots: 3 },
    { id: 'gas_engine', key: 'engine', label: 'Gas engines', color: '#ff5e57', slots: 12 },
    { id: 'fuel_cell', key: 'fuel', label: 'Fuel cells', color: '#6f8dff', slots: 6 },
    { id: 'battery_4h', key: 'battery', label: 'Battery 4h', color: '#4dff9d', slots: 12 },
];
const BY_KEY = Object.fromEntries(RES.map(r => [r.key, r]));

const LOCATIONS = {
    benchmark: { label: 'Williamson County, TX (hackathon benchmark)', solar: 1, wind: 1, price: 1, gas: 1, co2: 1, note: 'The released packet: ERCOT LZ_SOUTH prices, 2023 wind and solar shapes.' },
    permian: { label: 'West Texas, Permian Basin', solar: 1.12, wind: 1.25, price: 0.95, gas: 0.85, co2: 1, note: 'Strong wind and sun, cheap local gas.' },
    phoenix: { label: 'Phoenix, Arizona', solar: 1.28, wind: 0.6, price: 1.1, gas: 1.1, co2: 1.05, note: 'Best solar, weak wind, hot summers.' },
    iowa: { label: 'Central Iowa', solar: 0.82, wind: 1.3, price: 0.9, gas: 1.05, co2: 0.95, note: 'Wind belt, modest solar.' },
    virginia: { label: 'Loudoun County, Virginia', solar: 0.85, wind: 0.55, price: 1.3, gas: 1, co2: 0.95, note: 'Data Center Alley: tight grid, pricey power.' },
    oregon: { label: 'The Dalles, Oregon', solar: 0.9, wind: 0.95, price: 0.8, gas: 1.15, co2: 0.4, note: 'Hydro-heavy grid with low CO₂.' },
    custom: { label: 'Custom (edit resource & price data)', note: 'Your own multipliers below.' },
};
const ILLUSTRATIVE = 'Illustrative multipliers on the Texas hourly shapes.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const state = {
    E: null, lib: [], world: null, prefs: null, pool: [], poolKey: '', result: null,
    plan: null, planRow: null, planLabel: '', t: 0, playing: false, speed: 3, lastHour: -1,
    location: 'benchmark', workers: [], running: false,
    gridPct: [{ from: 18, pct: 25 / 75 }, { from: 24, pct: 50 / 75 }, { from: 30, pct: 1 }],
    weights: { speed: 1, cost: 1, env: 1 },
};

/* ------------------------------------------------------------------ formatting */
const fm = (v, d = 0) => (v == null || !isFinite(v) ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = v => (Math.abs(v) >= 1e6 ? '$' + fm(v / 1e6, 1) + 'M' : '$' + fm(v));
const pct = v => fm(100 * v, 0) + '%';

/* ------------------------------------------------------------------ boot */
const loaderBar = $('#loader-bar');
const loaderText = $('#loader-text');
async function boot() {
    if (PREVIEW) document.body.classList.add('is-preview');
    loaderBar.style.width = '25%';
    const [E, libRaw] = await Promise.all([loadEngine('./data/'), fetch('./data/library.json').then(r => r.json())]);
    state.E = E;
    state.lib = libraryRows(libRaw);
    loaderBar.style.width = '55%';
    loaderText.textContent = 'Building the campus, wind ridge and solar field';
    await new Promise(r => setTimeout(r, 30));

    const world = (state.three = new World($('#stage'), { preview: PREVIEW, still: STILL }));
    world.init();
    world.onPick = key => showCard(key);
    loaderBar.style.width = '80%';
    loaderText.textContent = 'Dispatching 87,600 hours for the recommended plan';
    await new Promise(r => setTimeout(r, 30));

    state.world = worldFromInputs();
    state.prefs = prefsFromInputs();
    precomputeClearSky();
    if (params.has('debug')) window.gt = state;
    if (!PREVIEW) buildUI();
    state.pool = state.lib;
    state.poolKey = worldKey();
    applyRecommendation(recommend(state.pool, state.prefs), true);

    // a striking first moment: year 3, the afternoon before the Aug 24 ERCOT conservation window
    const ev0 = E.meta.events[0].ref_hour;
    state.t = 2 * HPY + ev0 - 27;
    if (params.has('t')) state.t = +params.get('t');
    if (PREVIEW) { state.speed = 2; world.setLabels(false); }
    loaderBar.style.width = '100%';
    setTimeout(() => $('#loader').classList.add('is-done'), 200);
    setTimeout(() => $('#loader').remove(), 900);
    if (!PREVIEW && !EMBED && !sessionStorageGet('gt-intro')) openIntro();
    else if (EMBED && !PREVIEW && !sessionStorageGet('gt-intro')) openIntro();
    setPlaying(!STILL && (PREVIEW || !REDUCED));
    requestAnimationFrame(loop);
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } }

/* ------------------------------------------------------------------ inputs -> world / prefs */
function worldFromInputs() {
    if (PREVIEW) return { delay: 0, eventsOff: [], allowT1: true, allowT2: true, heat: false, outage: 0, site: defaultSite() };
    const peak = +$('#in-peak').value || 75;
    const site = {
        peakMw: peak, landLimit: +$('#in-land').value || 8,
        grid: [{ from: 0, mw: 0 }, ...state.gridPct.map(g => ({ from: g.from, mw: Math.round(g.pct * peak) }))],
        solarMult: +$('#in-solar').value || 1, windMult: +$('#in-wind').value || 1, priceMult: +$('#in-price').value || 1,
        gasMult: +$('#in-gas').value || 1, gridCo2Mult: state.location === 'custom' ? 1 : LOCATIONS[state.location].co2,
        prices: { utility_solar: +$('#in-ppa-solar').value || 40, wind: +$('#in-ppa-wind').value || 35, nuclear: +$('#in-ppa-nuc').value || 95 },
    };
    const eventsOff = $$('#events input').filter(i => !i.checked).map(i => +i.dataset.ev);
    return { delay: +$('#in-delay').value || 0, eventsOff, allowT1: $('#w-t1').checked, allowT2: $('#w-t2').checked, heat: $('#w-heat').checked, outage: 0, site };
}

function prefsFromInputs() {
    if (PREVIEW) return { weights: { speed: 1, cost: 1, env: 1 }, fullBy: 30, neverPause: true, hurdle: 100 };
    const on = id => $(id).checked;
    return {
        weights: { ...state.weights },
        fullBy: on('#lim-full-on') ? +$('#lim-full').value : null,
        maxUsd: on('#lim-usd-on') ? +$('#lim-usd').value : null,
        maxKg: on('#lim-kg-on') ? +$('#lim-kg').value : null,
        minClean: on('#lim-clean-on') ? +$('#lim-clean').value : null,
        neverPause: on('#lim-pause'),
        hurdle: +$('#lim-hurdle').value || 100,
    };
}

function worldMode(w = state.world) {
    if (!isBenchmarkSite(w.site)) return 'search';
    const common = !w.delay && !w.eventsOff.length && w.allowT1 && w.allowT2 && !w.heat;
    return common ? 'library' : 'reeval';
}
function worldKey() {
    const w = state.world;
    const mode = worldMode(w);
    return JSON.stringify([mode, w, mode === 'search' ? state.prefs.fullBy : null]);
}

/* ------------------------------------------------------------------ plan loading */
function applyRecommendation(res, initial = false) {
    state.result = res;
    if (res.chosen) loadPlan(res.chosen, 'Recommended portfolio');
    else if (res.relax.length) loadPlan(res.relax[0].pick, 'Closest plan (one limit relaxed)');
    if (!PREVIEW) renderPlanPanel();
}

function loadPlan(row, label) {
    const spec = { ...state.world, start: row.start };
    const m = state.E.evaluate(row.caps, spec, row.lam || 0, true);
    state.plan = m;
    state.planRow = row;
    state.planLabel = label;
    state.lim = limitsFor(state.world.site);
    prepPlanHourly(m);
    state.three.setPortfolio(unitsFor(row.caps));
    state.lastHour = -1;
    if (!PREVIEW) { renderTimelineMarks(); renderPlanPanel(); updateBadge(); }
}

function unitsFor(caps) {
    const lim = limitsFor(state.world.site);
    const u = {};
    for (const r of RES) {
        const mw = caps[r.id] || 0;
        // one model per catalog block where it fits (a 25 MW turbine, a 5 MW engine); scaled sites fall back to proportional
        const blocks = Math.round(mw / lim[r.id].block);
        u[r.key] = mw <= 0 ? 0 : blocks <= r.slots && r.key !== 'solar' && r.key !== 'wind' ? blocks : Math.max(1, Math.min(r.slots, Math.round((mw / lim[r.id].max) * r.slots)));
    }
    return { solarRows: u.solar, wind: u.wind, turbine: u.turbine, engine: u.engine, fuel: u.fuel, battery: u.battery, nuclear: u.nuclear };
}

/** Per-hour costs that don't depend on dispatch (capacity charges, pay-for-available contracts). */
function prepPlanHourly(m) {
    const E = state.E;
    const sc = m.sc;
    const fixed = new Float64Array(N);
    for (const k of IDS) {
        const mw = m.caps[k] || 0;
        if (!mw) continue;
        const h0 = Math.max(sc.spec.start, CATALOG[k].avail) * HPM;
        const per = (mw * E.annualCharge(k)) / HPY;
        const price = sc.site.prices[k] ?? CATALOG[k].price;
        for (let h = h0; h < N; h++) {
            fixed[h] += per;
            if (k === 'utility_solar') fixed[h] += mw * sc.solarCf[h] * price;
            else if (k === 'wind') fixed[h] += mw * sc.windCf[h] * price;
            else if (k === 'nuclear') fixed[h] += mw * price;
        }
    }
    state.fixedH = fixed;
    state.emax = (m.caps.battery_4h || 0) * RULES.battHours;
}

let clearSky = null;
function precomputeClearSky() {
    const R = state.E.R;
    clearSky = new Float32Array(13 * 24);
    for (let i = 0; i < HPY; i++) {
        const k = R.cal_month[i] * 24 + R.hod[i];
        clearSky[k] = Math.max(clearSky[k], R.solar_cf[i]);
    }
}

/* ------------------------------------------------------------------ hour state */
function hourState(t) {
    const m = state.plan, sc = m.sc, F = m.flows, A = m.avail, R = state.E.R;
    const h = Math.min(N - 1, Math.max(0, Math.floor(t)));
    const r = h % HPY;
    const hod = R.hod[r];
    const frac = t - Math.floor(t);
    const month = Math.floor(h / HPM);
    const rel = month - sc.spec.start;
    const loadFrac = rel < 0 ? 0 : rel >= RULES.ramp ? 1 : 1 / 3 + (rel * (2 / 3)) / RULES.ramp;
    const mw = {
        solar: F.solar[h], wind: F.wind[h], nuclear: F.nuc[h], grid: F.grid[h], turbine: F.gt[h], engine: F.ge[h], fuel: F.fc[h],
        dis: F.dis[h], chg: F.chg[h], reloc: F.reloc[h], intr: F.intr[h], unmet: F.unmet[h],
    };
    mw.import = mw.grid + mw.solar + mw.wind + mw.nuclear;
    mw.local = sc.load[h] - mw.reloc - mw.intr;
    const dayCf = clearSky[R.cal_month[r] * 24 + hod];
    let cloud = dayCf > 0.08 ? THREE_clamp(1 - R.solar_cf[r] / dayCf, 0, 1) : state.lastCloud ?? 0.2;
    state.lastCloud = cloud;
    const timeLapse = state.playing && state.speed >= 24;
    const lightHod = timeLapse ? (state.pinNight ? 1 : 13) : hod + frac;
    const cfOf = (av, out) => (av > 1e-6 ? out / av : 0);
    const online = k => month >= Math.max(sc.spec.start, CATALOG[k].avail);
    const lab = {};
    const lim = state.lim;
    for (const res of RES) {
        const cap = m.caps[res.id] || 0;
        const out = { solar: mw.solar, wind: mw.wind, nuclear: mw.nuclear, turbine: mw.turbine, engine: mw.engine, fuel: mw.fuel, battery: mw.dis - mw.chg }[res.key];
        let text, off = false;
        if (!cap) { text = 'not selected'; off = true; }
        else if (!online(res.id)) { text = `${fm(cap)} MW · online M${Math.max(sc.spec.start, CATALOG[res.id].avail)}`; off = true; }
        else if (res.key === 'battery') text = `${out > 0.01 ? `out ${fm(out, 1)} MW` : out < -0.01 ? `charging ${fm(-out, 1)} MW` : 'idle'} · ${pct(F.soc[h] / state.emax)}`;
        else text = `${fm(out, 1)} / ${fm(cap)} MW`;
        lab[res.key] = { text, off };
    }
    lab.campus = { text: loadFrac > 0 ? `${fm(sc.load[h], 1)} MW` : 'under construction', alert: mw.intr > 0.01 || mw.unmet > 0.01 };
    lab.grid = { text: sc.ordinary[h] > 0 ? `${fm(mw.import, 1)} / ${fm(sc.cap[h], 0)} MW` : 'no grid yet', alert: !!sc.stress[h], off: sc.ordinary[h] <= 0 };
    lab.market = { text: `${fm(mw.grid, 1)} MW · $${fm(sc.gridPrice[h], 0)}`, off: mw.grid < 0.01 };
    lab.remote = { text: mw.reloc > 0.01 ? `${fm(mw.reloc, 1)} MW moved` : 'standby', off: mw.reloc < 0.01, alert: mw.reloc > 0.01 };
    return {
        h, r, hod, month, loadFrac, mw, hodFrac: lightHod, doy: Math.floor(r / 24) + 1, cloud: cloud * 0.85,
        windCf: R.wind_cf[r], windYaw: 0.6 + Math.sin(h / 400) * 0.5, stress: !!sc.stress[h], ordinary: sc.ordinary[h], cap: sc.cap[h],
        peak: sc.site.peakMw, soc: F.soc[h], emax: state.emax, chg: mw.chg, dis: mw.dis, intr: mw.intr, reloc: mw.reloc,
        heatIndex: R.cal_month[r] >= 6 && R.cal_month[r] <= 9 && hod >= 11 && hod < 20 ? 1 : 0,
        frac: { turbine: cfOf(A.gt[h], mw.turbine), engine: cfOf(A.ge[h], mw.engine), fuel: cfOf(A.fc[h], mw.fuel), nuclear: cfOf(A.nuc[h], mw.nuclear) },
        labels: lab, timeLapse,
    };
}
function THREE_clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ------------------------------------------------------------------ main loop */
let lastT = performance.now();
let uiTick = 0;
function loop(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (state.paused) { requestAnimationFrame(loop); return; }
    if (state.playing && state.plan && !state.running) {
        state.t += dt * state.speed;
        if (state.t >= N - 1) { state.t = Math.max(state.plan.sc.spec.start * HPM, 0); }
    }
    if (state.plan) {
        const s = hourState(state.t);
        state.three.update(s);
        uiTick += dt;
        if (!PREVIEW && (s.h !== state.lastHour || uiTick > 0.25)) {
            uiTick = 0;
            state.lastHour = s.h;
            renderLive(s);
        }
    }
    requestAnimationFrame(loop);
}

function setPlaying(p) {
    state.playing = p;
    const b = $('#btn-play');
    if (b) {
        b.innerHTML = `<svg><use href="#i-${p ? 'pause' : 'play'}"/></svg>`;
        b.setAttribute('aria-label', p ? 'Pause' : 'Play');
    }
}

/* ------------------------------------------------------------------ UI build */
function buildUI() {
    // location presets
    const sel = $('#in-location');
    sel.innerHTML = Object.entries(LOCATIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    sel.addEventListener('change', () => {
        state.location = sel.value;
        const L = LOCATIONS[sel.value];
        if (sel.value !== 'custom') {
            $('#in-solar').value = L.solar; $('#in-wind').value = L.wind; $('#in-price').value = L.price; $('#in-gas').value = L.gas;
        }
        $('#loc-note').textContent = L.note + (sel.value !== 'benchmark' && sel.value !== 'custom' ? ' ' + ILLUSTRATIVE : '');
        markDirty();
    });
    $('#loc-note').textContent = LOCATIONS.benchmark.note;
    for (const id of ['#in-solar', '#in-wind', '#in-price', '#in-gas']) $(id).addEventListener('input', () => { if (state.location !== 'custom') { state.location = 'custom'; sel.value = 'custom'; $('#loc-note').textContent = LOCATIONS.custom.note; } markDirty(); });
    for (const id of ['#in-land', '#in-ppa-solar', '#in-ppa-wind', '#in-ppa-nuc']) $(id).addEventListener('input', markDirty);
    $('#in-peak').addEventListener('input', () => { renderGridSched(); markDirty(); });
    $('#in-delay').addEventListener('input', e => { $('#out-delay').textContent = `${e.target.value} month${e.target.value === '1' ? '' : 's'}`; markDirty(); });

    renderGridSched();
    $('#btn-reset').addEventListener('click', resetInputs);

    // tabs
    $$('.tabs button').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));

    // triangle
    setupTriangle();
    $$('#presets button').forEach(b => b.addEventListener('click', () => {
        const [s, c, e] = b.dataset.w.split(',').map(Number);
        setWeights({ speed: s, cost: c, env: e });
        $$('#presets button').forEach(x => x.classList.toggle('is-active', x === b));
        rerank();
    }));
    for (const id of ['#lim-full-on', '#lim-full', '#lim-usd-on', '#lim-usd', '#lim-kg-on', '#lim-kg', '#lim-clean-on', '#lim-clean', '#lim-pause', '#lim-hurdle']) {
        $(id).addEventListener('change', rerank);
    }
    $('#btn-run').addEventListener('click', runOptimizer);
    $('#btn-run2').addEventListener('click', runOptimizer);

    // stress windows
    $('#events').innerHTML = state.E.meta.events.map((e, i) => `<label class="ev"><input type="checkbox" checked data-ev="${i}"><span>${e.label}</span><small>${e.hours} h</small><button type="button" data-go="${i}">view</button></label>`).join('');
    $$('#events input').forEach(i => i.addEventListener('change', markDirty));
    $$('#events [data-go]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); jumpToEvent(+b.dataset.go); }));
    for (const id of ['#w-t1', '#w-t2', '#w-heat']) $(id).addEventListener('change', markDirty);

    // dock
    $('#btn-play').addEventListener('click', () => setPlaying(!state.playing));
    $('#in-speed').addEventListener('change', e => (state.speed = +e.target.value));
    $('#btn-day').addEventListener('click', () => jumpToHour(13, false));
    $('#btn-night').addEventListener('click', () => jumpToHour(1, true));
    $('#btn-stress').addEventListener('click', () => jumpToEvent());
    $('#views').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button type="button" data-view="${k}" class="${k === 'overview' ? 'is-active' : ''}">${v.label}</button>`).join('');
    $$('#views button').forEach(b => b.addEventListener('click', () => flyTo(b.dataset.view)));
    setupTimeline();

    // top bar
    const toggle = (btn, panel) => $(btn).addEventListener('click', () => {
        const on = $(btn).getAttribute('aria-pressed') !== 'true';
        $(btn).setAttribute('aria-pressed', on);
        $(panel).classList.toggle('is-hidden', !on);
        if (on && innerWidth <= 960) {
            const other = panel === '#planner' ? ['#btn-live', '#live'] : ['#btn-panel', '#planner'];
            $(other[0]).setAttribute('aria-pressed', 'false');
            $(other[1]).classList.add('is-hidden');
        }
    });
    toggle('#btn-panel', '#planner');
    toggle('#btn-live', '#live');
    if (innerWidth <= 960) {
        $('#btn-live').setAttribute('aria-pressed', 'false');
        $('#live').classList.add('is-hidden');
        $('#btn-panel').setAttribute('aria-pressed', 'false');
        $('#planner').classList.add('is-hidden');
    }
    if (innerWidth < 600) {
        $('#btn-labels').setAttribute('aria-pressed', 'false');
        state.three.setLabels(false);
    }
    $('#btn-labels').addEventListener('click', () => {
        const on = $('#btn-labels').getAttribute('aria-pressed') !== 'true';
        $('#btn-labels').setAttribute('aria-pressed', on);
        state.three.setLabels(on);
    });
    $('#btn-full').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    $('#btn-intro').addEventListener('click', openIntro);
    if (EMBED) {
        $('#btn-close').hidden = false;
        $('#btn-close').addEventListener('click', () => parent.postMessage({ type: 'gridtech:close' }, '*'));
        addEventListener('keydown', e => { if (e.key === 'Escape' && $('#intro').hidden && $('#card').hidden) parent.postMessage({ type: 'gridtech:close' }, '*'); });
    }
    $('#card-x').addEventListener('click', () => ($('#card').hidden = true));
    $('#intro-x').addEventListener('click', closeIntro);
    $('#intro-go').addEventListener('click', closeIntro);
    $('#intro-plan').addEventListener('click', () => {
        closeIntro();
        openTab('site');
        $('#btn-panel').setAttribute('aria-pressed', 'true');
        $('#planner').classList.remove('is-hidden');
    });
    addEventListener('keydown', e => {
        if (e.target.matches('input, select, textarea')) return;
        if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
        if (e.key === 'Escape') { $('#card').hidden = true; if (!$('#intro').hidden) closeIntro(); }
    });

    const pc = $('#pareto');
    pc.addEventListener('click', e => {
        if (!state.paretoHit) return;
        const r = pc.getBoundingClientRect();
        const row = state.paretoHit(e.clientX - r.left, e.clientY - r.top);
        if (row) loadPlan(row, 'Picked from the trade-off chart');
    });
    addEventListener('resize', () => renderPareto());
}

function openTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
    $$('.tabpane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === name));
    if (name === 'plan') requestAnimationFrame(renderPareto);
}
function openIntro() { $('#intro').hidden = false; }
function closeIntro() { $('#intro').hidden = true; sessionStorageSet('gt-intro', '1'); }

function renderGridSched() {
    const peak = +$('#in-peak').value || 75;
    const box = $('#grid-sched');
    box.innerHTML = state.gridPct.map((g, i) => `<div class="gs"><label>from M<input type="number" min="0" max="110" value="${g.from}" data-i="${i}" data-f="from"></label><label><input type="number" min="0" max="${peak * 2}" step="5" value="${Math.round(g.pct * peak)}" data-i="${i}" data-f="mw"> MW</label><button class="x" type="button" data-del="${i}" aria-label="Remove step">×</button></div>`).join('') +
        `<button class="add" type="button" id="gs-add">+ Add grid step</button>`;
    $$('input', box).forEach(inp => inp.addEventListener('change', () => {
        const g = state.gridPct[+inp.dataset.i];
        if (inp.dataset.f === 'from') g.from = Math.max(0, Math.round(+inp.value));
        else g.pct = Math.max(0, +inp.value) / peak;
        state.gridPct.sort((a, b) => a.from - b.from);
        renderGridSched();
        markDirty();
    }));
    $$('[data-del]', box).forEach(b => b.addEventListener('click', () => { state.gridPct.splice(+b.dataset.del, 1); renderGridSched(); markDirty(); }));
    $('#gs-add').addEventListener('click', () => {
        const last = state.gridPct[state.gridPct.length - 1];
        state.gridPct.push({ from: last ? Math.min(110, last.from + 6) : 18, pct: last ? Math.min(1, last.pct + 0.25) : 0.33 });
        renderGridSched();
        markDirty();
    });
}

function resetInputs() {
    $('#in-location').value = 'benchmark';
    state.location = 'benchmark';
    $('#loc-note').textContent = LOCATIONS.benchmark.note;
    $('#in-peak').value = 75; $('#in-land').value = 8; $('#in-delay').value = 0; $('#out-delay').textContent = '0 months';
    $('#in-solar').value = 1; $('#in-wind').value = 1; $('#in-price').value = 1; $('#in-gas').value = 1;
    $('#in-ppa-solar').value = 40; $('#in-ppa-wind').value = 35; $('#in-ppa-nuc').value = 95;
    $$('#events input').forEach(i => (i.checked = true));
    $('#w-t1').checked = true; $('#w-t2').checked = true; $('#w-heat').checked = false;
    state.gridPct = [{ from: 18, pct: 25 / 75 }, { from: 24, pct: 50 / 75 }, { from: 30, pct: 1 }];
    renderGridSched();
    markDirty();
    runOptimizer();
}

function markDirty() {
    state.world = worldFromInputs();
    const mode = worldMode();
    const st = $('#run-status');
    if (worldKey() === state.poolKey) { st.textContent = ''; return; }
    st.innerHTML = mode === 'library'
        ? 'Benchmark world: the 858-plan hackathon library applies instantly.'
        : mode === 'reeval'
            ? '<b>World changed.</b> Shortlisted library plans will be re-dispatched and repaired with firm gas where needed.'
            : '<b>New site.</b> A fresh portfolio search will run in your browser (about 5 to 15 seconds).';
    updateBadge(true);
}

function updateBadge(pending) {
    const w = state.world;
    const loc = LOCATIONS[state.location]?.label.replace(' (hackathon benchmark)', '') || 'Custom';
    const tag = worldMode(w) === 'library' ? 'Benchmark' : 'Custom world';
    $('#world-badge').textContent = `${tag} · ${fm(w.site.peakMw)} MW campus · ${loc}${pending ? ' · not yet optimized' : ''}`;
}

/* ------------------------------------------------------------------ triangle */
const TRI = { C: [130, 22], S: [22, 208], Env: [238, 208] };
function setupTriangle() {
    const svg = $('#tri'), dot = $('#tri-dot');
    let drag = false;
    const toWeights = (x, y) => {
        const [x1, y1] = TRI.C, [x2, y2] = TRI.S, [x3, y3] = TRI.Env;
        const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        let a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
        let b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
        a = Math.max(0, a); b = Math.max(0, b);
        let c = Math.max(0, 1 - a - b);
        const s = a + b + c;
        return { cost: a / s, speed: b / s, env: c / s };
    };
    const move = e => {
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 260, y = ((e.clientY - r.top) / r.height) * 232;
        setWeights(toWeights(x, y));
        $$('#presets button').forEach(b => b.classList.remove('is-active'));
    };
    svg.addEventListener('pointerdown', e => { drag = true; svg.setPointerCapture(e.pointerId); move(e); });
    svg.addEventListener('pointermove', e => drag && move(e));
    svg.addEventListener('pointerup', () => { if (drag) { drag = false; rerank(); } });
    setWeights(state.weights);
}
function setWeights(w) {
    const t = w.speed + w.cost + w.env || 1;
    state.weights = { speed: w.speed / t, cost: w.cost / t, env: w.env / t };
    const { speed, cost, env } = state.weights;
    const x = cost * TRI.C[0] + speed * TRI.S[0] + env * TRI.Env[0];
    const y = cost * TRI.C[1] + speed * TRI.S[1] + env * TRI.Env[1];
    const dot = $('#tri-dot');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    $('#tri-guides').setAttribute('points', `${TRI.C.join(',')} ${x},${y} ${TRI.S.join(',')} ${x},${y} ${TRI.Env.join(',')}`);
    $('#weights').innerHTML = [['Speed', speed, '#4fd6ff'], ['Cost', cost, '#f5c542'], ['Climate', env, '#4dff9d']]
        .map(([n, v, c]) => `<div><span>${n}</span><b>${Math.round(v * 100)}%</b><i style="--w:${v * 100}%;--c:${c}"></i></div>`).join('');
}

/* ------------------------------------------------------------------ re-ranking + optimizer */
function rerank() {
    state.prefs = prefsFromInputs();
    state.world = worldFromInputs();
    if (worldKey() !== state.poolKey) { markDirty(); $('#run-status').innerHTML += ' Press <b>Find best portfolio</b> to apply.'; return; }
    applyRecommendation(recommend(state.pool, state.prefs));
    summarizeRun();
}

function summarizeRun(extra = '') {
    const r = state.result;
    const st = $('#run-status');
    if (!r) return;
    st.innerHTML = r.chosen
        ? `<b>${fm(r.survivors.length)}</b> of ${fm(r.scope.length)} feasible plans pass your limits. Best match loaded.${extra}`
        : `<b>No plan meets every limit.</b> The closest option is loaded; see the Plan tab for one-click relaxations.${extra}`;
}

function shortlist() {
    const lib = state.lib.filter(r => r.feasible && r.start <= 30);
    const w = state.prefs.weights;
    const lo = k => Math.min(...lib.map(r => r[k])), hi = k => Math.max(...lib.map(r => r[k]));
    const L = { start: [lo('start'), hi('start')], usd_mwh: [lo('usd_mwh'), hi('usd_mwh')], kg: [lo('kg'), hi('kg')] };
    const n = (r, k) => (r[k] - L[k][0]) / (L[k][1] - L[k][0] || 1);
    const score = r => w.speed * n(r, 'start') + w.cost * n(r, 'usd_mwh') + w.env * n(r, 'kg');
    const pick = new Map(lib.slice().sort((a, b) => score(a) - score(b)).slice(0, 30).map(r => [r.id, r]));
    for (const m of new Set(lib.map(r => r.start))) {
        const rows = lib.filter(r => r.start === m);
        for (const r of [rows.reduce((a, b) => (b.total < a.total ? b : a)), rows.reduce((a, b) => (b.kg < a.kg ? b : a))]) pick.set(r.id, r);
    }
    return [...pick.values()];
}

function getWorkers(n) {
    while (state.workers.length < n) state.workers.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
    return state.workers.slice(0, n);
}

async function runOptimizer() {
    if (state.running) return;
    state.prefs = prefsFromInputs();
    state.world = worldFromInputs();
    const key = worldKey();
    const mode = worldMode();
    if (mode === 'library') {
        state.pool = state.lib;
        state.poolKey = key;
        applyRecommendation(recommend(state.pool, state.prefs));
        summarizeRun(' Source: precomputed hackathon library (858 Pareto plans, 33 opening months).');
        updateBadge();
        openTab('plan');
        return;
    }
    if (key === state.poolKey) { rerank(); openTab('plan'); return; }

    state.running = true;
    $('#btn-run').disabled = $('#btn-run2').disabled = true;
    const opt = $('#opt');
    opt.hidden = false;
    const nW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const workers = getWorkers(nW);
    let jobs;
    if (mode === 'reeval') {
        const rows = shortlist();
        jobs = [];
        for (let i = 0; i < rows.length; i += 4) jobs.push({ kind: 'reeval', rows: rows.slice(i, i + 4) });
        $('#opt-title').textContent = `Re-dispatching ${rows.length} shortlisted plans`;
    } else {
        const months = candidateMonths(state.world, state.prefs);
        jobs = months.map(m => ({ kind: 'search', month: m, seeds: seedsFor(state.lib, m, state.world.site) }));
        $('#opt-title').textContent = `Searching ${months.length} opening months on ${nW} threads`;
    }
    $('#opt-text').textContent = 'Each candidate is dispatched for all 87,600 hours';
    const total = jobs.length;
    let done = 0, evals = 0;
    const pool = [];
    const t0 = performance.now();
    const setPct = p => {
        $('#opt-pct').textContent = Math.round(p * 100) + '%';
        $('#opt-arc').style.strokeDashoffset = 107 * (1 - p);
    };
    setPct(0);
    const buckets = workers.map(() => []);
    jobs.forEach((j, i) => buckets[i % workers.length].push(j));
    await Promise.all(workers.map((w, wi) => new Promise(resolve => {
        if (!buckets[wi].length) return resolve();
        w.onmessage = ev => {
            const d = ev.data;
            if (d.type === 'eval') {
                state.three.setPortfolio(unitsFor(d.caps));
                $('#opt-feed').textContent = `M${d.start} · ${RES.filter(r => d.caps[r.id]).map(r => `${CATALOG[r.id].short} ${fm(d.caps[r.id])}`).join(' · ')} → ${d.feasible ? '$' + fm(d.usd_mwh, 1) + '/MWh' : 'misses hours'}`;
            } else if (d.type === 'job') {
                done++;
                evals += d.evals;
                pool.push(...d.pool);
                setPct(done / total);
            } else if (d.type === 'done') resolve();
        };
        w.onerror = e => { console.error(e); resolve(); };
        w.postMessage({ type: 'run', world: state.world, jobs: buckets[wi], budget: 75 });
    })));
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    opt.hidden = true;
    state.running = false;
    $('#btn-run').disabled = $('#btn-run2').disabled = false;
    pool.forEach((r, i) => (r.id = `${r.source[0]}${i}`));
    state.pool = pool;
    state.poolKey = key;
    if (!pool.length) {
        $('#run-status').innerHTML = `<b>No feasible portfolio found</b> after ${fm(evals)} dispatches. Give the site more grid, more land or a later deadline.`;
        state.three.setPortfolio(unitsFor(state.planRow.caps));
        return;
    }
    applyRecommendation(recommend(pool, state.prefs));
    summarizeRun(` ${fm(evals)} portfolios dispatched in ${secs} s.`);
    updateBadge();
    openTab('plan');
}

/* ------------------------------------------------------------------ plan panel */
function renderPlanPanel() {
    const m = state.plan, row = state.planRow, res = state.result;
    if (!m) return;
    $('#plan-kind').textContent = state.planLabel;
    $('#plan-title').textContent = `Opens month ${m.start} · full demand month ${m.full}`;
    const why = [];
    if (!m.feasible) why.push(`<b style="color:#ff8a80">This plan misses ${fm(m.unmet, 0)} MWh in ${m.unmetHours} hours.</b>`);
    why.push(`${fm(m.served / 1e3, 0)} GWh served over ten years, ${pct(m.merchant || 0)} bought from the market.`);
    if (m.reloc > 1) why.push(`${fm(m.reloc, 0)} MWh of Tier 1 work moved off site during grid emergencies.`);
    if (m.intr > 1) why.push(`${fm(m.intr, 0)} MWh of Tier 2 work paused.`);
    $('#plan-why').innerHTML = why.join(' ');
    $('#kpis').innerHTML = [
        [`$${fm(m.usd_mwh, 2)}`, 'per MWh requested'], [money(m.total), '10-year decision cost'], [`${fm(m.kg, 1)}`, 'kg CO₂ per MWh'],
        [pct(m.clean), 'clean energy share'], [`${fm(m.land, 2)} ac`, `of ${state.world.site.landLimit} acres onsite`], [`${fm(m.maxImport, 1)}`, 'peak import MW'],
    ].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
    const lim = limitsFor(state.world.site);
    $('#caps').innerHTML = RES.map(r => {
        const v = m.caps[r.id] || 0;
        return `<div class="cap ${v ? '' : 'is-zero'}" style="--c:${r.color}"><i></i><span>${r.label}</span><div class="bar"><u style="--w:${(100 * v) / lim[r.id].max}%"></u></div><b>${fm(v)} MW</b>
            <span class="stepper"><button type="button" data-step="${r.id}" data-d="-1" aria-label="Less ${r.label}">−</button><button type="button" data-step="${r.id}" data-d="1" aria-label="More ${r.label}">+</button></span></div>`;
    }).join('');
    $$('#caps [data-step]').forEach(b => b.addEventListener('click', () => editCap(b.dataset.step, +b.dataset.d)));

    const cl = $('#climate');
    const c = res && res.chosen === row ? res.climate : null;
    cl.className = 'climate';
    if (c && c.verdict === 'pivot') {
        cl.classList.add('is-pivot');
        cl.innerHTML = `<b>Climate check: switch recommended.</b> A plan opening in month ${c.pivot.start} cuts emissions ${fm(c.cutPct, 0)}% for about $${fm(c.implied, 0)} per tonne, below your $${c.hurdle}/t hurdle.<br><button type="button" id="pivot-go">Load the cleaner plan →</button>`;
        $('#pivot-go').addEventListener('click', () => loadPlan(c.pivot, 'Climate-check pivot'));
    } else if (c && c.verdict === 'weak') {
        cl.classList.add('is-weak');
        cl.innerHTML = '<b>Climate check: weak.</b> Above 200 kg/MWh and no cleaner plan is cheap enough per tonne. Move the marker toward Climate or raise the hurdle.';
    } else if (c) {
        cl.innerHTML = `<b>Climate check: efficient.</b> No materially cleaner plan is available below $${c.hurdle} per tonne of CO₂ avoided.`;
    } else if (res && !res.chosen && res.relax.length) {
        cl.classList.add('is-weak');
        cl.innerHTML = '<b>No plan meets every limit.</b> Relax one:' + res.relax.map((x, i) => `<br><button type="button" data-relax="${i}">${relaxText(x)} →</button>`).join('');
        $$('[data-relax]', cl).forEach(b => b.addEventListener('click', () => {
            const x = res.relax[+b.dataset.relax];
            applyRelax(x);
        }));
    } else cl.innerHTML = 'Custom plan: edit the blocks above to test your own mix.';

    // alternatives
    const alts = [];
    if (res) {
        for (const a of Object.values(res.archetypes || {})) if (a.row) alts.push([a.label, a.row]);
        (res.ranked || []).slice(1, 4).forEach((r, i) => alts.push([`Runner-up ${i + 1}`, r]));
    }
    $('#alts').innerHTML = alts.map(([lab, r], i) => `<button type="button" class="alt ${r === row ? 'is-current' : ''}" data-alt="${i}"><b>${lab}</b><em>$${fm(r.usd_mwh, 1)} · ${fm(r.kg, 0)} kg</em><span>Opens M${r.start} · ${RES.filter(x => r.caps[x.id]).map(x => `${x.label} ${fm(r.caps[x.id])}`).join(', ')}</span></button>`).join('');
    $$('#alts [data-alt]').forEach(b => b.addEventListener('click', () => { const [lab, r] = alts[+b.dataset.alt]; loadPlan(r, lab); }));
    renderPareto();
}

function relaxText(x) {
    if (x.axis === 'pause') return 'Allow pausing Tier 2 work';
    const unit = { full: 'month', usd_mwh: '$/MWh', kg: 'kg/MWh', clean: '%' }[x.key];
    const name = { speed: 'Full demand by', cost: 'Max cost', env: 'Max CO₂', clean: 'Min clean share' }[x.axis];
    return `${name} ${fm(x.value, x.key === 'usd_mwh' ? 1 : 0)} ${unit}`;
}
function applyRelax(x) {
    const map = { speed: ['#lim-full', v => Math.ceil(v)], cost: ['#lim-usd', v => Math.ceil(v * 10) / 10], env: ['#lim-kg', v => Math.ceil(v)], clean: ['#lim-clean', v => Math.floor(v)] };
    if (x.axis === 'pause') $('#lim-pause').checked = false;
    else $(map[x.axis][0]).value = map[x.axis][1](x.value);
    rerank();
}

function renderPareto() {
    if (PREVIEW || !state.result) return;
    const c = $('#pareto');
    if (!c.clientWidth) return;
    state.paretoHit = drawPareto(c, state.result.scope, state.planRow, state.result.frontier);
}

function editCap(id, d) {
    const lim = limitsFor(state.world.site);
    const caps = { ...state.plan.caps };
    caps[id] = Math.max(0, Math.min(lim[id].max, (caps[id] || 0) + d * lim[id].block));
    if (landUsed(caps) > state.world.site.landLimit + 1e-9) { flash(`Not enough land: ${fm(landUsed(caps), 2)} of ${state.world.site.landLimit} acres`); return; }
    loadPlan({ ...state.planRow, caps, id: 'custom' }, 'Your custom edit');
}

let flashT = 0;
function flash(text) {
    const st = $('#run-status');
    st.innerHTML = `<b style="color:#ff8a80">${text}</b>`;
    clearTimeout(flashT);
    flashT = setTimeout(() => summarizeRun(), 2600);
}

/* ------------------------------------------------------------------ live panel */
const SRC = [
    ['solar', 'Solar', '--c-solar'], ['wind', 'Wind', '--c-wind'], ['nuclear', 'Nuclear', '--c-nuclear'], ['grid', 'Market (ERCOT)', '--c-grid'],
    ['turbine', 'Gas turbine', '--c-turbine'], ['engine', 'Gas engines', '--c-engine'], ['fuel', 'Fuel cells', '--c-fuel'], ['dis', 'Battery out', '--c-battery'],
    ['chg', 'Battery charging', '--c-battery'], ['reloc', 'Moved to remote site', '--c-reloc'], ['intr', 'Work paused', '--c-intr'], ['unmet', 'Unserved', '--c-intr'],
];
function renderLive(s) {
    const m = state.plan, sc = m.sc, R = state.E.R;
    const r = s.r;
    $('#clk-date').textContent = `${MONTHS[R.cal_month[r] - 1]} ${R.day[r]}`;
    $('#clk-time').textContent = `${String(s.hod).padStart(2, '0')}:00`;
    $('#clk-month').textContent = `Month ${s.month} · Year ${Math.floor(s.h / HPY) + 1}`;
    const ph = $('#clk-phase');
    ph.className = 'phase' + (s.loadFrac <= 0 ? ' is-build' : s.loadFrac < 1 ? ' is-ramp' : '');
    ph.textContent = s.loadFrac <= 0 ? 'Construction' : s.loadFrac < 1 ? `Ramping ${pct(s.loadFrac)}` : 'Full load';
    const load = sc.load[s.h];
    $('#tl-load').innerHTML = `${fm(load, 1)}<em>MW</em>`;
    const mw = s.mw;
    const gp = sc.gasPrice[s.h];
    const g = k => CATALOG[k];
    const cost = state.fixedH[s.h] + mw.turbine * (g('gas_turbine').price + g('gas_turbine').hr * gp) + mw.engine * (g('gas_engine').price + g('gas_engine').hr * gp)
        + mw.fuel * (g('fuel_cell').price + g('fuel_cell').hr * gp) + mw.grid * sc.gridPrice[s.h] + mw.reloc * RULES.relocPrice + mw.intr * RULES.intrPrice;
    $('#tl-cost').innerHTML = `${money(cost)}<em>/h</em>`;
    const co2 = mw.turbine * g('gas_turbine').co2 + mw.engine * g('gas_engine').co2 + mw.fuel * g('fuel_cell').co2 + mw.grid * sc.gridCo2[s.h] + mw.reloc * RULES.remoteMult * sc.remoteCo2Base * sc.remoteCo2Factor[s.h];
    $('#tl-co2').textContent = `${fm(co2, 1)} t`;
    const clean = mw.solar + mw.wind + mw.nuclear - mw.chg + mw.dis;
    $('#tl-clean').textContent = mw.local > 0.01 ? pct(Math.max(0, clean) / mw.local) : '-';
    $('#tl-price').textContent = `$${fm(sc.gridPrice[s.h], 0)}/MWh`;
    const supply = SRC.slice(0, 8).map(([k, , c]) => [mw[k] || 0, c]);
    const tot = Math.max(load, supply.reduce((a, [v]) => a + v, 0), 1e-6);
    $('#stackbar').innerHTML = supply.map(([v, c]) => `<i style="width:${(100 * v) / tot}%;--c:var(${c})"></i>`).join('');
    $('#sources').innerHTML = SRC.map(([k, n, c]) => {
        const v = mw[k] || 0;
        if ((k === 'unmet' || k === 'intr' || k === 'reloc' || k === 'chg') && v < 0.01) return '';
        return `<li class="${v < 0.01 ? 'is-zero' : ''} ${k === 'chg' ? 'is-neg' : ''} ${['reloc', 'intr', 'unmet'].includes(k) ? 'is-bad' : ''}" style="--c:var(${c})"><i></i><span>${n}</span><b>${k === 'chg' ? '−' : ''}${fm(v, 1)} MW</b></li>`;
    }).join('');
    const ord = sc.ordinary[s.h];
    $('#tl-import').textContent = ord > 0 ? `${fm(mw.import, 1)} / ${fm(sc.cap[s.h], 0)} MW` : 'No grid connection yet';
    $('#tl-import-bar').style.width = ord > 0 ? `${(100 * mw.import) / ord}%` : '0%';
    $('#tl-import-cap').style.width = ord > 0 ? `${100 * (1 - sc.cap[s.h] / ord)}%` : '100%';
    $('#tl-soc').textContent = state.emax ? `${pct(m.flows.soc[s.h] / state.emax)} of ${fm(state.emax)} MWh` : 'No battery in plan';
    $('#tl-soc-bar').style.width = state.emax ? `${(100 * m.flows.soc[s.h]) / state.emax}%` : '0%';

    // alert banner
    const al = $('#alert');
    if (s.stress) {
        const ev = state.E.meta.events[R.event[r]];
        al.hidden = false;
        $('#alert-title').textContent = `ERCOT conservation window · ${ev ? ev.label : ''}`;
        $('#alert-text').textContent = `Import limit cut to ${fm(sc.cap[s.h], 0)} MW (60%).` + (mw.reloc > 0.01 ? ` Moving ${fm(mw.reloc, 1)} MW of Tier 1 work to the remote site.` : '') + (mw.intr > 0.01 ? ` Pausing ${fm(mw.intr, 1)} MW of Tier 2 work.` : '') + (mw.reloc < 0.01 && mw.intr < 0.01 ? ' Onsite supply covers the cut.' : '');
    } else al.hidden = true;

    // day/night buttons reflect the sky
    const isNight = s.timeLapse ? state.pinNight : state.three.night > 0.5;
    $('#btn-day').classList.toggle('is-active', !isNight);
    $('#btn-night').classList.toggle('is-active', isNight);

    // timeline head
    const p = state.t / (N - 1);
    $('#tl-head').style.left = `${p * 100}%`;
    $('#tl-fill').style.width = `${p * 100}%`;
    $('#tl-head-label').textContent = `M${s.month}`;

    // spark
    const from = Math.max(0, s.h - 48), to = Math.min(N, s.h + 24);
    const F = m.flows;
    drawSpark($('#spark'), {
        layers: [
            { color: '#ffc53d', values: F.solar }, { color: '#4fd6ff', values: F.wind }, { color: '#b28dff', values: F.nuc }, { color: '#cfd8dc', values: F.grid },
            { color: '#ff8a3d', values: F.gt }, { color: '#ff5e57', values: F.ge }, { color: '#6f8dff', values: F.fc }, { color: '#4dff9d', values: F.dis },
            { color: '#ff4fd8', values: F.reloc },
        ],
        load: sc.load, from, to, cursor: s.h, stress: sc.stress,
    });
    if (!$('#card').hidden && state.cardKey) fillCard(state.cardKey, s);
}

/* ------------------------------------------------------------------ timeline */
function setupTimeline() {
    const track = $('#tl-track');
    let drag = false;
    const seek = e => {
        const r = track.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        state.t = p * (N - 1);
        state.lastHour = -1;
    };
    track.addEventListener('pointerdown', e => { drag = true; track.setPointerCapture(e.pointerId); seek(e); });
    track.addEventListener('pointermove', e => drag && seek(e));
    track.addEventListener('pointerup', () => (drag = false));
}

function renderTimelineMarks() {
    const m = state.plan, sc = m.sc;
    const at = month => `${(100 * month) / 120}%`;
    const html = [];
    html.push(`<div class="band band--build" style="left:0;width:${at(m.start)}"></div>`);
    html.push(`<div class="band band--ramp" style="left:${at(m.start)};width:${at(RULES.ramp)}"></div>`);
    html.push(`<div class="mk mk--open" style="left:${at(m.start)}"><span>Open M${m.start}</span></div>`);
    html.push(`<div class="mk mk--full" style="left:${at(m.full)}"><span>Full M${m.full}</span></div>`);
    for (const g of sc.site.grid) if (g.mw > 0) html.push(`<div class="mk mk--grid" style="left:${at(g.from + (state.world.delay || 0))}"><span>${fm(g.mw)} MW</span></div>`);
    for (const y of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) for (const e of state.E.meta.events) {
        const h = y * HPY + e.ref_hour;
        if (h / HPM >= m.start) html.push(`<div class="mk mk--ev" style="left:${(100 * h) / N}%"></div>`);
    }
    $('#tl-marks').innerHTML = html.join('');
}

function jumpToHour(target, night) {
    state.pinNight = night;
    const h = Math.floor(state.t);
    const r = h % HPY;
    const hod = state.E.R.hod[r];
    let d = target - hod;
    if (d < 0 && night) d += 24;
    state.t = Math.max(0, Math.min(N - 1, h + d)) + 0.01;
    state.lastHour = -1;
}

function jumpToEvent(idx) {
    const start = state.plan.start * HPM;
    const now = Math.floor(state.t);
    const hours = [];
    for (let y = 0; y < 10; y++) state.E.meta.events.forEach((e, i) => {
        const h = y * HPY + e.ref_hour;
        if (h >= start && (idx == null || i === idx)) hours.push(h);
    });
    hours.sort((a, b) => a - b);
    const best = hours.find(h => h > now + 3) ?? hours[0];
    if (best == null) return;
    state.t = best - 3 + 0.01;
    state.lastHour = -1;
    flyTo('grid');
    if (state.speed > 3) { state.speed = 1; $('#in-speed').value = '1'; }
}

function flyTo(name) {
    state.three.flyTo(name);
    $$('#views button').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
}

/* ------------------------------------------------------------------ asset info card */
const INFO = {
    solar: ['Offsite contract', 'Utility solar PPA', 'Pay-for-available physical delivery: the campus pays for every MWh the field could make, used or not, so the dispatch takes it first. Shares the campus grid wire.', 'utility_solar', 'solar'],
    wind: ['Offsite contract', 'Wind PPA', 'Pay-for-available contract from a regional wind farm, available from month 12. Night-time wind is the backbone of the cheapest plans. Shares the grid wire.', 'wind', 'wind'],
    nuclear: ['Offsite contract', 'Nuclear physical PPA', 'Hypothetical firm clean supply from a new offsite plant at month 60, 25 MW cap. Expensive, but it is what lets the clean plans reach about 11 kg/MWh.', 'nuclear', 'nuclear'],
    turbine: ['Onsite · natural gas', 'Gas turbine', '25 MW blocks from month 18, 0.1 acre/MW. The cheapest firm onsite capacity, used to ride through the import cap and stress windows.', 'gas_turbine', 'turbine'],
    engine: ['Onsite · natural gas', 'Reciprocating engines', '5 MW blocks from month 16, 0.05 acre/MW. Flexible firm power that lets a campus open before the grid arrives.', 'gas_engine', 'engine'],
    fuel: ['Onsite · natural gas', 'Fuel cells', '5 MW blocks from month 14, the only resource ready on day one. Low heat rate but a high capacity charge.', 'fuel_cell', 'fuel'],
    battery: ['Onsite · storage', '4-hour battery', 'Charges only from surplus clean contract energy, 85% round trip, ≤365 cycles a year, and keeps a reserve ahead of every stress window.', 'battery_4h', 'battery'],
    campus: ['Load', 'AI data center campus', 'Total facility AC demand incl. cooling. Service starts at 1/3 load and ramps to full over 10 months. Tier 0 is never touched; Tier 1 can move to a remote site and Tier 2 can pause, only inside stress windows.'],
    grid: ['Grid connection', 'Campus import wire', 'Every offsite MWh (market, solar, wind, nuclear) flows through this one limit. It grows from 0 to 75 MW by month 30 and drops to 60% during ERCOT conservation windows.'],
    market: ['Merchant power', 'ERCOT wholesale market', 'Hourly LZ_SOUTH prices plus a $20/MWh adder, rising 5%/yr in real terms. Negative-price hours are taken first.'],
    remote: ['Demand response', 'Remote data center', 'Tier 1 workloads can relocate here during stress windows: up to 12 MW, 1.05× energy, $123.50 per local MWh.'],
    yard: ['Onsite', 'Campus switchyard', 'Where onsite generation, the battery and the grid import meet before feeding the halls.'],
};
function showCard(key) {
    if (PREVIEW) return;
    if (!INFO[key]) return;
    state.cardKey = key;
    $('#card').hidden = false;
    fillCard(key, hourState(state.t));
    const view = { turbine: 'onsite', engine: 'onsite', fuel: 'onsite', battery: 'onsite', yard: 'onsite', market: 'grid' }[key] || key;
    if (VIEWS[view]) flyTo(view);
}
function fillCard(key, s) {
    const [kind, title, text, id, mk] = INFO[key];
    $('#card-kind').textContent = kind;
    $('#card-title').textContent = title;
    $('#card-text').textContent = text;
    const m = state.plan, rows = [];
    if (id) {
        const c = CATALOG[id];
        const cap = m.caps[id] || 0;
        const L = m.ledger[id];
        rows.push(['In this plan', cap ? `${fm(cap)} MW` : 'not selected']);
        rows.push(['Now', s.labels[mk].text]);
        rows.push(['Available from', `month ${c.avail}`]);
        rows.push(['Block / max', `${c.block} / ${fm(limitsFor(state.world.site)[id].max)} MW`]);
        if (c.basis === 'available') rows.push(['Contract price', `$${state.world.site.prices[id] ?? c.price}/MWh`]);
        else rows.push(['Capex / FOM', `$${fm(c.capex)}/kW · $${c.fom}/kW-yr`]);
        if (c.hr) rows.push(['Heat rate', `${c.hr} MMBtu/MWh`]);
        if (c.land) rows.push(['Land', `${c.land} acre/MW`]);
        if (cap) rows.push(['10-year cost', money(L.total)]);
        if (cap && m.mix[id] != null) rows.push(['10-year energy', `${fm(m.mix[id] / 1e3, 0)} GWh`]);
    } else if (key === 'campus') {
        rows.push(['Demand now', `${fm(m.sc.load[s.h], 1)} MW`], ['Peak', `${fm(m.sc.site.peakMw)} MW`], ['Load factor', '92%'], ['Served over 10 yrs', `${fm(m.served / 1e3, 0)} GWh`], ['Work moved', `${fm(m.reloc, 0)} MWh`], ['Work paused', `${fm(m.intr, 0)} MWh`]);
    } else if (key === 'grid') {
        rows.push(['Import now', `${fm(s.mw.import, 1)} MW`], ['Limit now', `${fm(s.cap, 0)} MW`], ['Ordinary limit', `${fm(s.ordinary, 0)} MW`], ['Peak import (plan)', `${fm(m.maxImport, 1)} MW`]);
    } else if (key === 'market') {
        rows.push(['Buying now', `${fm(s.mw.grid, 1)} MW`], ['Price now', `$${fm(m.sc.gridPrice[s.h], 1)}/MWh`], ['10-year market energy', `${fm(m.merchantMwh / 1e3, 0)} GWh`], ['10-year market cost', money(m.merchantCost)]);
    } else if (key === 'remote') {
        rows.push(['Moving now', `${fm(s.mw.reloc, 1)} MW`], ['10-year moved', `${fm(m.reloc, 0)} MWh`], ['10-year cost', money(m.relocCost)]);
    } else {
        rows.push(['Onsite land used', `${fm(m.land, 2)} acres`], ['Feeding halls now', `${fm(s.mw.local, 1)} MW`]);
    }
    $('#card-dl').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}

/* ------------------------------------------------------------------ embed messaging */
let hostPaused = false;
function syncPause() {
    state.paused = hostPaused || document.hidden;
    state.three?.setPaused(state.paused);
}
addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'gridtech:pause') { hostPaused = true; syncPause(); }
    if (d.type === 'gridtech:resume') { hostPaused = false; syncPause(); }
});
document.addEventListener('visibilitychange', syncPause);

boot().catch(err => {
    console.error(err);
    $('#loader-text').textContent = 'Could not start the simulation: ' + err.message;
});
