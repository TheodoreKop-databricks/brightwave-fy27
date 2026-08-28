/**
 * The campaign-desk action-taking agent — Brightwave.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) pointed at Databricks'
 * Responses API. Tools capture `db` + `userEmail` via closure so every
 * action is attributed to the viewing user (OBO).
 *
 * ════════════════════════════════════════════════════════════════════════
 * TOOL SUITE — this one agent READS FROM and ACTS ACROSS what would
 * otherwise be four separate tools (all IMPLEMENTED + wired below):
 * ════════════════════════════════════════════════════════════════════════
 *   - `ask_data`               → BI / Genie: natural-language investigation of
 *                                the governed lakehouse (config-driven
 *                                MAS-OR-Genie — whichever backend is set).
 *   - `find_underperformer`    → Lakebase read (synced.* UC mirror): the live
 *                                underperformer position + matching winner.
 *   - `rank_actions`           → ML in the loop: the XGBoost model's ranked
 *                                actions (recommended action + predicted lift).
 *   - `search_creatives`       → Lakebase SEARCH (BM25): full-text retrieval
 *                                over the Build-1 creatives_search_bm25 index.
 *   - `execute_campaign_action`→ ACT: the human-in-the-loop write-back to
 *                                Postgres (app.campaign_actions_app + event).
 *
 * That breadth is the point: a single agent turn can investigate (Genie),
 * retrieve creatives (Lakebase Search), score with the ML model, and then
 * commit an approved action to the writable store — unifying tools that
 * normally live in separate systems. The three-phase chain
 * (Discover → Draft+confirm → Execute) is described in the instructions below.
 *
 * KEEP `configureAgentsSdk()` as-is — it handles the Databricks Responses API
 * wiring, the `Connection: close` stale-socket workaround, and the 64-char
 * `input[*].id` strip.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { serviceAuthHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
// Build-2 read helpers (Assist) — reads over synced.* / write to app.*.
import {
  getUnderperformer,
  worstUnderperformer,
  getCampaign,
  getRecommendation,
  searchCreatives as searchCreativesIndex,
  recordCampaignAction,
  type ActionType,
} from '../db/queries/campaigns.js';
// The data-backend helpers. Both are config-driven and share the same
// DataCallResult shape + ToolProgressEvent stream, so the `ask_data` tool
// below can delegate to EITHER without the UI caring which powers it. This
// preserves the template's MAS-OR-Genie flexibility exactly.
import { callMasEndpoint } from './tools/mas.js';
import { callGenieSpace } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint. */
export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** MAS serving-endpoint name the `ask_data` tool talks to WHEN SET. Set in
   * `config/app.json` as `masEndpointName` (env `MAS_ENDPOINT_NAME`). Leave
   * empty to use Genie instead. This is the trainee's Build-1 backend choice
   * — the app registers whichever of MAS/Genie is configured. */
  masEndpointName: string;
  /** Genie space id the `ask_data` tool talks to WHEN `masEndpointName` is
   * empty. Set as `genieSpaceId` (env `GENIE_SPACE_ID`). */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  /** Called by long-running tools to surface progress to the UI. */
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  /** Mutated by the OpenAI fetch shim on any non-2xx. */
  modelError?: { current: ModelErrorDetail | null };
};

// ────────────────────────────────────────────────────────────────────────────
// Adding / editing tools — READ THIS before touching `parameters: z.object(...)`.
//
// The Agents SDK ships every tool's zod schema to the Responses API with
// `strict: true`. Strict mode requires EVERY property in `required`. So use
// `.nullable()`, NOT `.optional()`:
//   ❌  reason: z.string().optional()   // breaks with strict:true (masked 502)
//   ✅  reason: z.string().nullable()   // field required, value may be null
// Every field needs a `.describe(...)`. Keep property names snake_case.
// Use the `loggedTool` wrapper (imported as `tool`), not the raw SDK `tool`.
// ────────────────────────────────────────────────────────────────────────────
function makeTools(ctx: AgentContext): Tool[] {
  // ── ask_data — SHIPS WORKING. Config-driven MAS-OR-Genie. ─────────────────
  // Delegates to the MAS endpoint if one is configured, else the Genie space.
  // Both helpers return {answer, trace_id} and stream progress via
  // ctx.onToolProgress → the Thinking panel. Registered ONLY when a backend
  // is configured (otherwise the tool would 404 confusingly).
  const askData = tool({
    name: 'ask_data',
    description:
      'Investigate the governed lakehouse with a natural-language question — the tool generates SQL / retrieves knowledge and returns a synthesized answer. Use for any "why" / "what happened" / investigative question about campaigns, creative performance, or ROAS trends. Prefer ONE narrow, well-formed question over many small ones.',
    parameters: z.object({
      question: z
        .string()
        .describe(
          'A clear, focused English question about the data. Narrow questions finish in 20–40s; broad multi-part questions take longer.',
        ),
    }),
    execute: async ({ question }) =>
      mlflow.withSpan(
        async () =>
          ctx.masEndpointName
            ? callMasEndpoint(ctx, ctx.masEndpointName, question)
            : callGenieSpace(ctx, ctx.genieSpaceId, question),
        {
          name: 'ask_data',
          spanType: mlflow.SpanType.TOOL,
          inputs: { question },
        },
      ),
  });

  // ── find_underperformer — Build 2 · Assist. Lakebase read (synced.* UC mirror).
  // Reads the underperformer position for {campaign_id} (or the worst one) from
  // synced.open_underperformers + synced.campaign_position: ROAS, spend,
  // recoverable spend, matching winner. Helpers in server/db/queries/campaigns.ts:
  // `getUnderperformer`, `worstUnderperformer`, `getCampaign`.
  const findUnderperformer = tool({
    name: 'find_underperformer',
    description:
      'Read the live underperforming campaign for {campaign_id} (or the worst underperformer) from Lakebase: ROAS, spend, recoverable spend, matching winner context. Read-only.',
    parameters: z.object({
      campaign_id: z
        .string()
        .nullable()
        .describe('Campaign id, e.g. CMP-0000214. Null → return the worst underperformer.'),
    }),
    execute: async ({ campaign_id }) =>
      mlflow.withSpan(
        async () => {
          const up = campaign_id
            ? await getUnderperformer(ctx.db, campaign_id)
            : await worstUnderperformer(ctx.db);
          if (!up) return { found: false };
          const pos = await getCampaign(ctx.db, up.campaignId);
          return {
            found: true,
            campaign_id: up.campaignId,
            channel: up.channel,
            category: up.category,
            target_segment: up.targetSegment,
            roas: up.roas,
            spend_to_date_usd: up.spendToDateUsd ?? pos?.spendToDateUsd ?? null,
            recoverable_spend_usd: up.recoverableSpendUsd,
            perf_band: pos?.perfBand ?? null,
            has_matching_winner: up.hasMatchingWinner,
            matching_winner_campaign_id: up.matchingWinnerCampaignId,
            matching_winner_roas: up.matchingWinnerRoas,
            reallocate_target_campaign_id: up.reallocateTargetCampaignId,
          };
        },
        {
          name: 'find_underperformer',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id },
        },
      ),
  });

  // ── rank_actions — Build 2 · Assist. ML in the loop. ──────────────────────
  // Reads the XGBoost model's ranked actions for {campaign_id} from
  // synced.action_recommendations: recommended action type, predicted ROAS
  // lift, predicted net value, and all three options (for what-if).
  // Helper: `getRecommendation` in server/db/queries/campaigns.ts.
  const rankActions = tool({
    name: 'rank_actions',
    description:
      'Read the ML model\'s ranked campaign actions — the demo\'s "ML in the loop" moment. Returns recommended action, predicted ROAS lift, and all three options.',
    parameters: z.object({
      campaign_id: z
        .string()
        .describe('Campaign id, e.g. CMP-0000214'),
    }),
    execute: async ({ campaign_id }) =>
      mlflow.withSpan(
        async () => {
          const rec = await getRecommendation(ctx.db, campaign_id);
          if (!rec) {
            return {
              scored: false,
              note: `No action recommendation found for ${campaign_id} in synced.action_recommendations.`,
            };
          }
          return {
            campaign_id: rec.campaignId,
            recommended_action: rec.recommendedAction,
            predicted_roas_lift: rec.predictedRoasLift,
            predicted_net_value_usd: rec.predictedNetValueUsd,
            // All three options — quote these in the recommendation + what-if.
            action_ranking: rec.actionRanking.map((o) => ({
              action_type: o.actionType,
              predicted_roas_lift: o.predictedRoasLift,
              predicted_net_value_usd: o.predictedNetValueUsd,
              action_cost_usd: o.actionCostUsd ?? null,
            })),
          };
        },
        {
          name: 'rank_actions',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id },
        },
      ),
  });

  // ── search_creatives — Build 2 · Assist. Lakebase SEARCH (BM25). ──────────
  // Full-text retrieval over the Build-1 Lakebase Search index
  // (app.creatives_search + app.creatives_search_bm25, index type lakebase_bm25)
  // — NOT a separate/external search store. Runs `to_bm25query(...)` over the
  // search_tsv tsvector. Implementation: `searchCreatives` (aliased
  // searchCreativesIndex) in server/db/queries/campaigns.ts.
  const searchCreatives = tool({
    name: 'search_creatives',
    description:
      'Search the creative catalog (names + descriptions) using Lakebase Search. Returns matching creatives with context.',
    parameters: z.object({
      query: z
        .string()
        .describe('Search query, e.g. "lifestyle" or "social media" or "video"'),
    }),
    execute: async ({ query }) =>
      mlflow.withSpan(
        async () => {
          const hits = await searchCreativesIndex(ctx.db, query, 6);
          return {
            query,
            count: hits.length,
            results: hits.map((h) => ({
              creative_id: h.creativeId,
              creative_name: h.creativeName,
              creative_type: h.creativeType,
              angle: h.angle,
              description: h.description,
            })),
            note:
              hits.length === 0
                ? 'No creative matches (or the Lakebase Search index is not available yet).'
                : null,
          };
        },
        {
          name: 'search_creatives',
          spanType: mlflow.SpanType.TOOL,
          inputs: { query },
        },
      ),
  });

  // ── execute_campaign_action — Build 2 · Act. Human-in-the-loop write-back. ─
  // Writes the approved action (+ drafted brief) to app.campaign_actions_app and
  // records a decision event in app.workflow_events, then returns the action_id.
  // NEVER touches the read-only synced.* Unity Catalog mirror. Helper:
  // `recordCampaignAction` in server/db/queries/campaigns.ts.
  const executeCampaignAction = tool({
    name: 'execute_campaign_action',
    description:
      'Record an approved campaign action (replicate_winner / reallocate_budget / pause + drafted brief) to the campaign desk. Writes to app.campaign_actions_app and triggers dataMutated → Campaign Desk refresh. Human-in-the-loop: only call after user approval.',
    parameters: z.object({
      campaign_id: z
        .string()
        .describe('Campaign id, e.g. CMP-0000214'),
      action_type: z
        .string()
        .describe('replicate_winner / reallocate_budget / pause'),
      target_campaign_id: z
        .string()
        .nullable()
        .describe('Winner replicated or reallocation target; null for pause'),
      drafted_brief: z
        .string()
        .describe('The agent-drafted campaign brief'),
      predicted_roas_lift: z
        .number()
        .nullable()
        .describe('Predicted ROAS lift from the model, if available'),
    }),
    execute: async ({
      campaign_id,
      action_type,
      target_campaign_id,
      drafted_brief,
      predicted_roas_lift,
    }) =>
      mlflow.withSpan(
        async () => {
          const { actionId, eventId } = await recordCampaignAction(ctx.db, {
            campaignId: campaign_id,
            actionType: action_type as ActionType,
            targetCampaignId: target_campaign_id,
            draftedBrief: drafted_brief,
            predictedRoasLift: predicted_roas_lift,
            userEmail: ctx.userEmail,
          });
          return {
            recorded: true,
            action_id: actionId,
            decision_event_id: eventId,
            campaign_id,
            action_type,
            approved_by: ctx.userEmail,
            predicted_roas_lift,
          };
        },
        {
          name: 'execute_campaign_action',
          spanType: mlflow.SpanType.TOOL,
          inputs: { campaign_id, action_type },
        },
      ),
  });

  // All five tools are implemented and registered so the model can chain them:
  // find_underperformer / rank_actions / search_creatives (Lakebase Search / BM25)
  // / execute_campaign_action (write-back). ask_data (Genie/MAS) is registered
  // only when a backend is configured.
  const tools: Tool[] = [
    findUnderperformer,
    rankActions,
    searchCreatives,
    executeCampaignAction,
  ];
  if (ctx.masEndpointName || ctx.genieSpaceId) {
    tools.unshift(askData);
  }
  return tools;
}

const AGENT_INSTRUCTIONS = `You are the Brightwave Campaign Desk agent, working for Priya Anand (CMO, Brightwave). Marketing attribution lands late, so a fifth of paid spend is stuck in underperforming campaigns (~1.1 ROAS) while a cluster of winners (~4.0 ROAS) quietly outperform on a specific channel+creative combination. Your job: isolate WHY winners win, then help Priya replicate that across underperformers — mid-quarter, while it still matters. CMP-0000214 is the exemplar underperformer.

You have these tools:
- ask_data — investigate the governed lakehouse in natural language (Genie). Use for "why"/"what's winning" questions.
- find_underperformer({campaign_id}) — the live position of an underperformer (or the worst): ROAS, spend, recoverable spend, and its matching winner. campaign_id null → worst.
- rank_actions({campaign_id}) — the ML model's ranked actions: recommended_action + predicted_roas_lift + predicted_net_value_usd, and action_ranking with ALL THREE options (replicate_winner / reallocate_budget / pause).
- search_creatives({query}) — Lakebase full-text search over the creative catalog; use it to find the transferable WINNING creative and ground an on-brand brief.
- execute_campaign_action({...}) — records the approved action. HUMAN-IN-THE-LOOP: only after the user explicitly approves.

Follow this flow:

MODE A — investigate (a "why is X underperforming / what's winning" question):
  1. Call ask_data to investigate (e.g. why CMP-0000214 underperforms and which campaigns/creatives are winning on the same audience).
  2. Call find_underperformer to pull the live position + matching winner.
  3. Answer with the drivers: the underperformer's ROAS/spend/recoverable spend, the matching winner and its ROAS, and the channel+creative pattern that explains the gap. Be concrete and quote the numbers.

MODE B — rank + recommend + draft (a "rank the action / use the model / how do I fix it" request):
  1. Call rank_actions for the campaign. Quote all three options — replicate_winner, reallocate_budget, pause — each with its predicted ROAS lift and predicted net value in $.
  2. Recommend the top-ranked move and explain WHY it beats the others (compare the net values / lifts you just quoted).
  3. Offer a short arithmetic what-if grounded in action_ranking (e.g. "replicating the winner projects a +X ROAS lift → ~$Y net value vs reallocation's $Z").
  4. Call search_creatives (e.g. the winner's angle/type) and use the hits to draft a concise, on-brand campaign brief for the replicate play — reference the actual winning creative(s) by name/angle.
  5. STOP and present the recommendation + brief for approval. DO NOT call execute_campaign_action yet.

MODE C — act (only after the user approves, e.g. "yes, replicate the winner"):
  1. Call execute_campaign_action with the approved action_type, the target_campaign_id (the winner for replicate / the reallocation target — null for pause), the drafted_brief, and the predicted_roas_lift from the model.
  2. Confirm what was recorded, quoting the returned action_id — never invent it.

Rules: never call execute_campaign_action before explicit approval. Ground every number in a tool result, not memory. Keep answers tight and decision-oriented — Priya wants the move, the why, and the projected value.`;

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Use the app SERVICE PRINCIPAL token (not the user OBO token) for the model
  // endpoint: OBO carries only user-consented scopes and 403s "required scopes:
  // model-serving" when consent hasn't propagated. The SP token has full API
  // access. Per-user attribution is preserved elsewhere (approved_by=userEmail,
  // MLflow trace user), not via this inference call's token.
  const headers = await serviceAuthHeaders();
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // Custom fetch: fresh TCP connection per call (avoids the stale-socket 502
  // after a long ask_data hop) + strip the >64-char `input[*].id` the SDK
  // echoes back on round 2 (Databricks' Responses API rejects long ids and
  // the streaming gateway masks the 400 as a bare 502). See git history.
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = {
              status: resp.status,
              url,
              bodyText: text,
              code,
              message,
            };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });

  setDefaultOpenAIClient(client);
  // Tracing is auto-wired by mlflow-tracing; disable to see raw agent loops.
  setTracingDisabled(false);

  const tools = makeTools(ctx);
  if (tools.length === 0) {
    console.warn('[agent] No tools configured — ask_data backend not set.');
  }

  const agent = new Agent({
    name: 'brightwave-campaign-desk',
    model: ctx.model,
    tools,
    instructions: AGENT_INSTRUCTIONS,
  });

  // Agent is ready for use. Caller (chat-stream/agent-stream.ts) wires it
  // into the event stream.
  global.agentInstanceDEV = { agent, tools };
}

// DEV: place for the global agent instance (so tools can debug-log).
// This is NOT a proper DI pattern — it's a workaround for the Agents SDK's
// async agent construction (needs to happen inside configureAgentsSdk before
// the first chat message). In production, return the agent from this module
// and wire it properly.
declare global {
  var agentInstanceDEV: { agent: Agent; tools: Tool[] } | undefined;
}
