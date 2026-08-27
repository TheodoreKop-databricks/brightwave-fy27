# Workshop - Brightwave (Campaign Replication & Budget Rescue)

**The use case, in plain words:** Brightwave is a $1B consumer brand. Some marketing campaigns are **winning big** on a specific channel-and-creative combination while others are **burning about a fifth of the paid budget** — and by the time attribution lands, the quarter is over. You build an app that spots the winners and the underperformers side by side, explains **why** the winners work, recommends the best move for each underperformer — **copy a winning campaign's template, shift its budget to a proven winner, or pause it** — and lets the CMO approve it while the quarter is still in play. The data, the recommendation, and the AI that drafts on-brand copy are all governed on Databricks, with content-generation AI spend capped and observable.

## 🎓 Start here — you build this, it isn't pre-built

Starting point for the Tech Summit FY27 Live Days **AI Customer Challenge**. It ships the **data
generator + specs + a bootstrap app** — **you build the solution** (that's the exercise). Build like
a citizen developer: **describe your intent to Genie Code and iterate**. Work carries forward
step by step.

### ▶️ How to start

**1. Get the template into your workspace.** Download it from **go/solution-builder** and import the folder into your Databricks workspace (Workspace → *Import*). Everything you need travels with it — work directly from there.

**2. Open a Genie Code session** in that folder and kick it off with this prompt:

> *"Read `README.md`, then all the files under `specifications/`, to build up the full context of
> this workshop — the story, the data model, and each component I need to create. Then read
> `data_generation/generate_data.py` to understand how the raw data is structured. Before doing
> anything, ask me which **catalog and schema** to use. Then run `data_generation/generate_data.py`
> as a **job run** into that catalog/schema to load the raw data. Put all the files you create in
> this project folder — transformation code under `./transformation`, and the dashboard, Genie
> space, and everything else at the root (`./`)."*

From there, build the solution one component at a time — SDP pipeline, dashboard, Genie, Lakebase, app, gateway.

**3. Build the solution**, iterating with Genie Code, using the per-component detail in `specifications/`. For the app, point your agent at `app/APP_WORKSHOP.md`.

Everything below is the **story + reference spec** the build should realize. The `specifications/`
folder has the full detail per component; `resources.json` lists the capabilities.

---

## The Story

| | |
|---|---|
| **Company** | Brightwave — a ~$1B consumer brand (~$200M annual media spend, dozens of concurrent campaigns) |
| **Hero** | Priya Anand, CMO (non-technical) |
| **Problem** | A cluster of campaigns split into winners (high ROAS on a specific channel+creative) and underperformers (~20% of spend), and attribution lands too late to act mid-quarter |
| **Investigation** | Priya asks *"Which campaigns are winning and why, and how do I replicate that across the ones that aren't?"* — the platform ranks replicate vs. reallocate vs. pause per underperformer |
| **Root cause** | The winning channel+creative+targeting combination is understood weeks later when attribution resolves, after the budget is spent |
| **Impact** | ~$13M recoverable spend on the sampled active underperformers (~$40M/yr at the full $200M media budget — talking-track), ROAS gap of ~4.0 (winners) vs ~1.1 (underperformers) |

---

## Overview

Priya Anand (CMO) opens the marketing console and sees two clusters on one chart: green winners quietly outperforming on a specific social + lifestyle-creative combination, and red underperformers burning ~20% of the paid budget while the quarter is still in play. She asks — *"which campaigns are winning, and how do I replicate that across the ones that aren't?"* — and the app isolates the winners' drivers, ranks **replicate / reallocate / pause** for each underperformer by projected ROAS lift, recommends replicating the winner (a matching winner with a transferable creative exists), drafts the new campaign brief, and writes it back after she approves. Governed campaign + spend data, a governed recommendation, and a governed AI assistant — on-brand, with content-generation AI spend capped and observable.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Campaigns (sampled) | ~2,000 over 18 months |
| Channels | social / search / display / video / email |
| Hero campaign | CMP-0000214 — active underperformer (ROAS ~1.1) with a matching winner (ROAS ~4-5, transferable creative) |
| Divergence sharpened | ~3 weeks ago (dynamic — `DIVERGENCE_RAMP = NOW − 3 weeks`) |
| Winners | ~60 (high ROAS on social + lifestyle creative) |
| Active underperformers | ~90 (low ROAS, ~20% of paid spend, still running) |
| Recoverable spend (sampled) | ~$13M (full-year-budget figure ~$40M — talking-track) |
| ROAS gap | winners ~4.0 vs underperformers ~1.1 |
| Action ranked by model | replicate winner / reallocate budget / pause + predicted ROAS lift |
| Assistant AI spend | Capped ~$300K/yr, on-brand, content-generation attributable |

---

## The demo arc (what the finished solution shows)

1. **See it** — open the Campaign Desk app: a ROAS×spend scatter, green winners high + red underperformers low, with recoverable-spend + ROAS-gap KPIs.
2. **Ask why** — in the chat dock, ask which campaigns are winning and why CMP-0000214 is underperforming; the assistant investigates via Genie + the creative catalog over the governed lakehouse.
3. **Get the action** — the assistant ranks replicate / reallocate / pause by projected ROAS lift and recommends replicating the winner, with a what-if + a drafted on-brand brief.
4. **Act** — approve → the action + the brief write back to Lakebase → the queue and KPIs update live.
5. **Governed AI** — every content-generation call runs through Unity AI Gateway (spend cap, guardrails, attribution), keeping it on-brand + bounded.

Full per-component detail is in `specifications/`.
