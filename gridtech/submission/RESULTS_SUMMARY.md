# GridTech Studio: results summary

All numbers below come from the same 87,600-hour engine that produced `portfolio.json` and `dispatch.csv`. Every submission folder was run through the official `starter/check_submission.py`; costs match the checker to the cent.

## 1. Recommended result (`recommended/`)

Customer: balanced triangle preferences (speed = cost = environment). Full demand by month 30 is a HARD deadline; everything else is a preference.

- Initial service month **16**, full demand month **26**
- Portfolio: Utility solar contract 85 MW, Wind contract 180 MW, Onsite natural-gas turbine 25 MW, Onsite natural-gas reciprocating engine 30 MW  (land 4.00 of 8 acres)
- 10-year total decision cost **$354.9M**  (**$70.20/MWh** of requested demand)
- Combined CO2 intensity **53.5 kg/MWh**, clean share **83.8%**, merchant electricity 11.3% of local energy
- Relocated 0 MWh, interrupted 0 MWh; Tier 0 always served locally; peak import 75.0 MW
- Checker: `physical_checks_passed = true`

## 2. Four customer archetypes (`alternatives/`, each checker-verified)

| Archetype | Opening | Full demand | Portfolio | $/MWh | kg CO2/MWh | Clean | Interrupted MWh |
|---|---|---|---|---|---|---|---|
| Cost Minimizer | 19 | 29 | Utility solar contract 60 MW, Wind contract 120 MW, Onsite natural-gas turbine 25 MW | 51.42 | 118 | 72% | 0 |
| Clean Champion | 30 | 40 | Utility solar contract 150 MW, Wind contract 200 MW, 4-hour battery 12 MW, Onsite natural-gas turbine 25 MW, Future offsite nuclear physical PPA 25 MW | 91.93 | 11 | 96% | 0 |
| Speed Maximizer | 14 | 24 | Utility solar contract 25 MW, Wind contract 70 MW, Onsite natural-gas turbine 25 MW, Onsite natural-gas reciprocating engine 10 MW, Onsite natural-gas fuel cell 30 MW | 78.19 | 227 | 40% | 0 |
| Zero Tier 2 Interruption | 19 | 29 | Utility solar contract 60 MW, Wind contract 120 MW, Onsite natural-gas turbine 25 MW | 51.42 | 118 | 72% | 0 |

Priority presets in the studio (marker at each corner) give the same story: speed pulls the opening earlier onto islanded fuel cells and engines (no grid before month 18); climate adds wind, solar, storage and nuclear and accepts a later opening; cost sits near the grid milestones.

## 3. Customer questions 1-7

1. **Full demand by month 24 vs 30:** +$154M total (+62%), +26.75 $/MWh.
2. **Lowest cost, deadline month 36:** opens month 19 at 51.42 $/MWh, 118 kg/MWh, merchant 11%.
3. **Below 100 kg CO2/MWh:** earliest full demand month 24 (open 14), 82.73 $/MWh, 90 kg/MWh.
4. **Continuity during grid stress (no Tier 2 interruption):** for the recommended plan the extra equipment is none and the extra cost $+0.0M; Tier 2 paused 0 MWh, Tier 1 moved 0 MWh (peak 0% of its limit), import limit exceeded by at most 0.0000 MW over 288 stress hours, Tier 0 always local. Stricter test without relocation: no extra equipment, +0.0M. Optimised plans per opening month: `sensitivities/continuity_zero_tier2.json`.
5. **Grid slips 6 months:** keeping month 24 costs $242.2M vs $225.0M if opening moves to month 30 (adapting is +17.2M).
6. **10% premium for month 24:** the month-24 plan needs +62% over the cheapest month-30 plan, so it does NOT fit a 10% premium (cap $275M).
7. **Staged additions:** saves $2.6M versus upfront for the chosen plan (see `sensitivities/staged_capacity.json`).

## 4. Best / Baseline / Worst for the recommended portfolio

| Scenario | Total $M | $/MWh | kg/MWh | Clean | Unserved MWh |
|---|---|---|---|---|---|
| Best case | 366.9 | 72.56 | 48 | 86% | 0.0 |
| Baseline | 354.9 | 70.20 | 54 | 84% | 0.0 |
| Worst-case stress | 370.3 | 73.24 | 79 | 79% | 236.5 |

To serve all load in the worst case, add 5 MW Onsite natural-gas reciprocating engine (about $11.5M per scenario).

Delay zones (0-12 months): Safe: all load served and <= +0.5% total cost. Manageable: all load served and <= +3%. High stress: unserved energy or > +3%.

## 5. Folder map

- `recommended/`: portfolio.json, dispatch.csv, check_results.json for the recommended result
- `alternatives/{cost_minimizer,clean_champion,speed_maximizer,zero_tier2_interruption}/`: one checker-verified package each
- `sensitivities/grid_delay_6mo_*`: delay-adapted portfolios (grid_delay_months = 6), plus continuity_zero_tier2.json, scenarios.json, staged_capacity.json, resource_performance.json (labelled extensions, not the common model)
- `VERIFICATION.txt`: output of `scripts/verify_submission.py` (7 audits per folder) and the official checker
- `README.md`: method, simplifications, AI disclosure
