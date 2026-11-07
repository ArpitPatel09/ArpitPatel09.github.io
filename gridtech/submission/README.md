# GridTech Studio

A decision tool for the GRIDTECH v5.5.1 benchmark (fictional 75 MW campus, Williamson County TX, 120-month horizon).
A customer drags a **leaf inside a speed / cost / environment triangle**, types any of three numbers, flips **per-window stress switches**, and gets a
feasible portfolio that has been dispatched hour by hour for all 87,600 hours. Every exported plan passes `packet/starter/check_submission.py`
and its decision cost matches the checker to the cent.

All code lives in this folder. The released packet files are copied **unchanged** into `packet/` so the folder is self-contained.

## Run it

```bash
cd gridtech_studio
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # numpy, pandas, numba, fastapi, uvicorn
./run.sh                      # http://localhost:8000   (PORT=9000 ./run.sh to change)
```
Reproduce everything from scratch (about 6 + 1 minutes on 8 cores):
```bash
.venv/bin/python -m engine.search 8      # builds cache/library.json (Pareto portfolios for 33 opening months)
.venv/bin/python build_all.py            # questions 1-7, priority-change demo, Submission_Package/ (runs the official checker on each folder)
.venv/bin/python tests/verify_against_checker.py   # our accounting vs. the official checker on 3 portfolios
```

## What the customer sees

The page has six tabs: **Home, Plan, Grid emergencies, What if, Common questions, Export**. Every chart carries a one- or two-sentence "Takeaway" generated from the numbers on screen, and every label uses plain words with a hover explanation.

| Piece | Behaviour |
|---|---|
| **Triangle** (Cost top, Speed bottom-left, Environment bottom-right) | Draggable marker = barycentric **preference weights**. A dashed ghost shows where the plan lands. Presets: Fastest / Cheapest / Greenest / Balanced. |
| **Priority limits** (next to the triangle) | Three rows, each with a metric dropdown and a slider. Gray track = min..max of that metric across the library ("what any plan can reach"); blue = the acceptable range, set by one limit handle on the worse side (clean share is higher-is-better, so its blue sits on the right); black dot = the recommended plan, recomputed on every change. Speed: full-demand month (M24-M40) or service-start month (M14-M30); Cost: $/MWh, 10-year total $M, running cost only (total minus capacity charges), % over the cheapest plan; Environment: kg CO2/MWh, clean share %, total tonnes. Changing a dropdown converts the limit where a clean conversion exists (speed +-10 months, $/MWh <-> % over cheapest) and otherwise resets it to "any plan". A fixed row, "Work paused: Never (requirement)", is on by default. Total-based metrics show "Totals favor later starts because they serve less energy." |
| **Ranking** | Limits and the Never-pause box are **hard filters** on the library. Survivors are ranked with augmented Tchebycheff, `max(w*n) + 0.01*sum(w*n)`, using the selected metrics min-max normalised over the survivors. |
| **No survivors** | Never "impossible": each limit is relaxed one at a time to its nearest feasible value and shown as a one-click option with the plan it gives ("Relax the cost limit to $74/MWh"), plus the closest plan. |
| **Climate check** | If a materially cleaner plan costs less than your hurdle per tonne, the studio recommends switching and shows the extra cost, plus a "pay $X more to cut emissions to Y" ladder. |
| **Continuity during grid stress** (Grid emergencies tab, Problem Statement example 4) | For the plan on screen the engine re-dispatches with Tier 2 interruption forbidden and adds the cheapest firm onsite blocks (engine, fuel cell, turbine, battery) until every hour is served, reporting the extra equipment and extra 10-year cost. It proves hour by hour that imports stay under the reduced limit in all stress hours, Tier 1 relocation stays within 12/1.05 MW, and Tier 0 is served locally. A stricter column also forbids relocation. Below it, fully re-optimized lowest-cost plans for the same opening month (pausing allowed / no pauses / no pauses and no relocation) come from `engine/continuity.py` (precomputed for months 14-30). Result: for the cheapest plans no extra equipment is needed because Tier 1 relocation (about 900 MWh over ten years) covers the cut; without relocation +5 MW of gas engine (about +$6M) is needed. |
| **Grid emergencies tab** | One switch per window (7), plus moving-work, pausing-work and grid-delay controls; per-window moved / paused / gas / battery results and an hourly chart. Any switch re-dispatches shortlisted plans and repairs them with firm gas if needed. |
| **What if tab** | Good year / official data / bad year bars, a 0-12 month grid-delay curve, a reliability card that is true or false from the hourly results, a "cheapest fix" button that prices extra firm gas, and the staged-capacity test. |
| **Common questions** | Seven precomputed questions; each button sets up the Plan tab. |
| **Export** | `portfolio.json`, `dispatch.csv`, and a button that runs the official checker on the current plan. |
| **Assistant** (bottom right) | A chat popup that explains terms and the repository from a built-in knowledge base (`engine/knowledge.py`) and can describe the plan on screen. If `ANTHROPIC_API_KEY` is set in the server environment, the retrieved notes are sent to Claude to phrase the answer; otherwise or on any failure it answers offline. |

## Method

**0. The framework drives everything.** `framework/FRAMEWORK.md` is the optimization framework (objective, constraints, accounting, derating, archetypes, verification). Its machine-readable twin `framework/framework.json` is loaded by `engine/framework.py` at start-up; land limit, battery efficiency and cycles, demand-response limits and prices, CRF (`r(1+r)^n/((1+r)^n-1)`, r = 0.08), heat derating (`Cap x [1 - beta x max(0, T - T_ref)]` at 40 C) and the four archetype objectives all come from it. `check_against_packet()` compares every catalog and rule value with the released packet and refuses to start on any mismatch. `tests/verify_against_timeline.py` proves the engine's month-20 inputs equal `packet/data/timeline_default.csv` (framework section 3.2).

**Archetypes (`engine/archetypes.py`, framework section 7.1).** Each archetype's objective (`levelized_cost` or `intensity`), tie-break, constraints and dispatch carbon price are read from the framework. The optimizer scores every library plan in the allowed opening months under the archetype's own world (Zero Tier 2 forbids interruption in the dispatch), then runs a block-by-block local search from the three best seeds with firm-gas repair. Results: Cost Minimizer and Zero Tier 2 share the same plan (it already never pauses work); Clean Champion lands on 25 MW nuclear, a 12 MW battery and maximum solar and wind; Speed Maximizer opens in month 14 on fuel cells and engines. They are packaged in `Submission_Package/alternatives/` and shown on the Plan tab with a Load button.


**1. Model (`engine/data.py`, `dispatch.py`, `model.py`).** Inputs are expanded exactly as MODEL_RULES section 1-3 and 5 describe (clock, commissioning ramp, grid schedule with optional delay,
price and CO2 trajectories, stress windows). `Spec` describes one world (opening month, delay, switched-off windows, shocks). `evaluate(caps, spec)` runs a numba hourly dispatch (about 8 ms) and the common accounting. The default Spec is the benchmark.

**2. Operating logic.** (Battery update: besides the 8 priciest hours, the battery also discharges in other hours, but only the energy that free surplus clean power will refill within 24 hours; it never displaces free or negative-price energy. Round trip stays exactly 85%. An upper-bound test shows the battery cannot repay its capacity charge in these plans even if it replaced every MWh of market power and gas, which is why cost-led plans leave it out.) Each hour: (1) negative-price merchant energy; (2) pay-for-available contracts (wind, solar, nuclear), since their cost is sunk; (3) a merit stack of merchant / turbine / engine / fuel cell by marginal cost (`price + adder`, `variable O&M + heat rate x gas price`); (4) battery covers any shortfall and in the 8 highest-priced hours of each day shaves the most expensive source, always keeping a reserve for the next stress window (the window calendar repeats yearly); (5) last resorts, only inside stress windows: relocate Tier 1 ($123.50/MWh) then interrupt Tier 2 ($1,000/MWh); (6) surplus clean contract energy that fits under the import cap charges the battery; (7) the final 168 hours drain the battery so SOC ends at 0. Merchant and all offsite contracts share the import cap; Tier 0 is never touched. Any unserved hour makes a plan infeasible; it is never exported.

**3. Search (`engine/search.py`).** Per opening month (14-42 each, plus 48, 54, 60, 72) a continuation local search minimises `decision cost + lambda x CO2 tonnes` along a ladder of lambda in {0 ... 3000} $/t (lambda also steers the dispatch merit order). Every feasible portfolio found goes into a pool; the (cost, CO2) **Pareto frontier** (26 points per month, 858 total, about 56k dispatches) is the library. It is a limited heuristic search, not a proof of optimality. Tested ranges: solar 0-150, wind 0-200 (5 MW), battery 0-12 (1 MW), turbine 0-75 (25 MW, land-limited), engine 0-60, fuel cell 0-30, nuclear 0-25 (5 MW).

**4. Recommendation (`engine/recommend.py`).** Scope = library plans with full demand by month 40 (opening by month 30), 442 plans. Hard limits filter; survivors are ranked by augmented Tchebycheff on the selected metrics (see the table above). The default metrics are per-MWh so a later opening, which serves less energy inside the fixed horizon, cannot look cheaper or cleaner; total-based metrics carry a warning. Served, relocated and interrupted MWh stay visible everywhere.

**5. Preference vs. requirement.** Triangle weights = preferences (trade-offs allowed). Priority limits and the Never-pause rule = hard requirements. Example: "earlier is better" = weight on Speed; "we must be at full demand by month 24" = a Speed limit of M24.

**6. Climate check.** All comparisons use $/MWh and kg/MWh. The pivot candidate is the plan (opening <= chosen + 3 months, respecting hard timing) minimising `$/MWh + hurdle x kg/MWh / 1000`. A pivot is recommended when it cuts intensity by at least 10% at an implied price below the hurdle (default $100/t, a team assumption). Intensity above 200 kg/MWh with no beneficial pivot is flagged weak.

**7. Business valuations (separate from common costs).** Climate hurdle ($/t), willingness-to-pay premium (ceiling = (1+p) x the cheapest common-model plan reaching full demand by a chosen month), and value of a month earlier (changes the ranking only) are customer valuations. The reported `total_decision_cost` is always local energy + relocation + interruption under the common rules.

**8. Scenarios.** Best: no delay, delivered gas -25%, wind/solar availability +10% (clipped at 100%). Baseline: official inputs. Worst: 6-month grid delay, 105 F summer-afternoon derate (turbine -8.5%, engine -3%, fuel cell -3%, 11:00-20:00 local, Jun-Sep) and gas +25%. Under pay-for-available contracts, higher renewable availability raises payments, so a renewable-heavy plan can cost slightly more in the "best" world; the UI says so. Unserved energy is valued at $1,000/MWh for display only.

## Business logic and results at a glance

Default customer (balanced triangle, full demand by month 30 as a hard Speed limit, no paused work): see `Submission_Package/RESULTS_SUMMARY.md` (the ranking now uses survivor-normalised Tchebycheff, so the balanced pick favours the middle of each metric's survivor range).
Changing priority changes the plan: see `Submission_Package/RESULTS_SUMMARY.md` (speed-first opens at month 14 on islanded fuel cells; cost-first sits near the grid milestones; climate-first adds nuclear and storage and accepts a later opening).

## Submission package (`Submission_Package/`)

```
README.md  RESULTS_SUMMARY.md  VERIFICATION.txt
recommended/                    portfolio.json  dispatch.csv  check_results.json  summary.json
alternatives/cost_minimizer/    lowest $/MWh
alternatives/clean_champion/    lowest CO2 intensity with clean share >= 70%
alternatives/speed_maximizer/   month-14 launch
alternatives/zero_tier2_interruption/   no Tier 2 work paused (asserted: interrupted MWh = 0)
sensitivities/grid_delay_6mo_{keep_month24,open_month30}/   grid_delay_months = 6, checker-verified
sensitivities/scenarios.json  staged_capacity.json  resource_performance.json   labelled extensions (not the common model)
```
Every folder with a portfolio.json is audited by `scripts/verify_submission.py` (independent of the engine) and the official checker; the result is saved in `VERIFICATION.txt`.

## Extensions and their assumptions (all disclosed, none enter the common total unless labelled)

* **Staged capacity (Example 7):** defers part of a contract/gas resource to month 30/36/48/60; land still reserves the full envelope; battery stays upfront; cost counts charges from the stage month and charges continue to month 120. Cannot be written to `portfolio.json`, so the checked upfront plan is submitted alongside.
* **Resource performance:** heat-wave derate follows `Cap x [1 - beta x max(0, T - T_ref)]` at the 40 C (104 F) heat-wave point: turbine 8.5% (the 7-10% band with evaporative cooling), engine 3% (2.5-3.5%), fuel cell 3% (assumption). The packet has no hourly temperature series, so the derate is a flat factor on Jun-Sep 11:00-20:00 local rather than a per-hour temperature lookup. Other assumptions (no source): startup charge $60 / $18 / $45 per MW started; minimum stable output 40% / 30% / 20% and hourly ramp are reported as diagnostics, not enforced; forced outage as a flat availability derate; renewable degradation per year; gas-delivery limit in MMBtu/h scales onsite gas availability.
* **Stress windows off:** an interactive what-if, not the benchmark. The official export always uses the common model (plus the chosen grid delay).

## Simplifications and limitations

* Heuristic search; a failed search is not proof of impossibility. Library covers 33 opening months (14-42, 48, 54, 60, 72); what-if worlds re-dispatch about 40-60 shortlisted plans and repair with firm gas.
* Battery reserve uses the repeating window calendar as foresight (stated in the rules as a reproducible pattern); notice is not simulated below one hour.
* Hourly adequacy only; no unit commitment, UPS or uptime certification. Offers, dates and site limits are fictional.
* Climate hurdle default $100/t and the 10% pivot threshold are team assumptions.

## Verification

* `scripts/verify_submission.py [folder] [--checker]` audits any submission folder: (1) 87,600 rows and model_hour 0..87599, (2) hourly balance <= 1e-4 MW, (3) import cap incl. stress events, (4) battery SOC bounds, start 0, end 0, continuity and <= 365 cycles/yr, (5) land <= 8 acres, (6) whole blocks within maxima, (7) relocation/interruption only in stress hours and within limits with Tier 0 served.
* `tests/verify_against_checker.py` exports three portfolios (months 14, 18, 20) and compares cost, intensity, clean share, served and merchant energy to the official checker: all identical to 1e-6.
* `build_all.py` asserts our total cost equals the checker's for every package folder it writes.

## AI and software disclosure

Built with Claude Code (Anthropic model "Sonnet 5.5") under the team's direction: engine, search, API and interface code were AI-generated and reviewed against the checker. Libraries: NumPy, pandas, numba, FastAPI, uvicorn. No external data, live APIs or hosted fonts are used; charts are hand-written SVG. The packet in `packet/` is the unmodified released v5.5.1 data.
