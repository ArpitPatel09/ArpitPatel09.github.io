/* Optimizer worker: runs the 87,600-hour engine off the main thread.
 * Jobs: {kind:'search', month, seeds} for a custom site, {kind:'reeval', rows} for a changed benchmark world. */
import { loadEngine } from './engine.js';
import { searchMonth, reevalRows } from './optimizer.js';

const ready = loadEngine('../data/');

self.onmessage = async ev => {
    const msg = ev.data;
    if (msg.type !== 'run') return;
    const E = await ready;
    let last = 0;
    const tick = (caps, m, n) => {
        const now = performance.now();
        if (now - last < 140) return;
        last = now;
        self.postMessage({ type: 'eval', caps, feasible: m.feasible, usd_mwh: m.usd_mwh, kg: m.kg, start: m.start, n });
    };
    for (const job of msg.jobs) {
        if (job.kind === 'search') {
            const { pool, evals } = searchMonth(E, msg.world, job.month, job.seeds, { budget: msg.budget, onEval: tick });
            self.postMessage({ type: 'job', pool, evals });
        } else {
            const pool = reevalRows(E, msg.world, job.rows, (c, m) => tick(c, m, 0));
            self.postMessage({ type: 'job', pool, evals: job.rows.length });
        }
    }
    self.postMessage({ type: 'done' });
};
