import type { AppContext } from '../../context.js';
import { notFound, tooMany } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { consume, refund, userPlan } from '../billing/entitlements.js';
import { isEnabled } from '../ops/flags.js';
import { raiseOpsAlert } from '../../pipeline/context.js';
import { answerQuestion, type AnswerResult } from './orchestrator.js';
import { NARRATIVE_PROMPT_VERSION } from './gateway.js';
import { TOOL_VERSION } from './tools.js';

// Assistant service (PRD AIA-01..AIA-13): quotas and rate limits, persistence of every answer with
// its versions, claims and tool calls, the release gate for model narrative, and cost monitoring.

export const AI_RATE_LIMIT_PER_MINUTE = 10;
export const ONBOARDING_FREE_QUESTIONS = 3;

/** AIA-13 release gate: model narrative is used only if the full evaluation passed for this exact configuration. */
export async function narrativeAllowed(ctx: AppContext): Promise<boolean> {
  if (ctx.ai.provider === 'deterministic') return false;
  if (!(await isEnabled(ctx.db, 'ai_llm_narrative'))) return false;
  const run = await ctx.db.maybeOne<{ passed: boolean }>(`SELECT passed FROM ai.eval_runs WHERE provider=$1 AND model_id=$2 AND prompt_version=$3 AND tool_version=$4 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`, [ctx.ai.provider, ctx.ai.model, NARRATIVE_PROMPT_VERSION, TOOL_VERSION]);
  return !!run?.passed;
}

export async function ask(ctx: AppContext, user: { userId: string; experienceLevel: string | null }, input: { conversationId?: string; question: string; context?: Record<string, string | undefined>; onboarding?: boolean }, onProgress: (step: string) => void): Promise<{ conversationId: string; messageId: string; result: AnswerResult; latencyMs: number }> {
  const t0 = Date.now();
  const rl = ctx.limiter.hit(`ai:${user.userId}`, AI_RATE_LIMIT_PER_MINUTE, 60_000);
  if (!rl.allowed) throw tooMany(`You can ask up to ${AI_RATE_LIMIT_PER_MINUTE} questions a minute. Try again in a few seconds.`, { retry_after_ms: rl.resetMs });
  onProgress('Finding data');
  let conv = input.conversationId ? await ctx.db.maybeOne<{ conversation_id: string; user_id: string; context: Record<string, string> }>(`SELECT conversation_id, user_id, context FROM ai.conversations WHERE conversation_id=$1 AND deleted_at IS NULL`, [input.conversationId]) : undefined;
  if (conv && conv.user_id !== user.userId) throw notFound();
  if (!conv) {
    conv = await ctx.db.one(`INSERT INTO ai.conversations (user_id, title, context, purge_after) VALUES ($1,$2,$3, now() + interval '12 months') RETURNING conversation_id, user_id, context`, [user.userId, input.question.slice(0, 80), JSON.stringify(input.context ?? {})]);
  }
  const context = { ...(conv!.context ?? {}), ...(input.context ?? {}) } as Record<string, string | undefined>;
  // Quota: onboarding questions are free (J2); policy and clarification replies are refunded.
  const plan = await userPlan(ctx.db, user.userId, ctx.clock());
  let charged = false;
  let onboardingFree = false;
  if (input.onboarding) {
    const used = await ctx.db.maybeOne<{ count: number }>(`SELECT count FROM app.usage_counters WHERE user_id=$1 AND metric='onboarding_questions'`, [user.userId]);
    if ((used?.count ?? 0) < ONBOARDING_FREE_QUESTIONS) {
      onboardingFree = true;
      await ctx.db.query(`INSERT INTO app.usage_counters (user_id, metric, period_start, count) VALUES ($1,'onboarding_questions','2000-01-01',1) ON CONFLICT (user_id, metric, period_start) DO UPDATE SET count = app.usage_counters.count + 1`, [user.userId]);
    }
  }
  if (!onboardingFree) {
    await consume(ctx.db, user.userId, 'ai_questions', plan, ctx.clock());
    charged = true;
  }
  await track(ctx.db, 'ai_question_asked', { context_type: context.run_id ? 'backtest' : context.company_id ? 'company' : context.briefing_date ? 'briefing' : 'none', tokens_budget: 2600, plan: plan.plan }, { userId: user.userId, plan: plan.plan, origin: 'server' });
  const userMsg = await ctx.db.one<{ message_id: string }>(`INSERT INTO ai.messages (conversation_id, role, content_json) VALUES ($1,'user',$2) RETURNING message_id`, [conv!.conversation_id, JSON.stringify({ text: input.question, context })]);
  void userMsg;
  onProgress('Calculating');
  const rights = await ctx.rights();
  let result: AnswerResult;
  let toolCalls;
  try {
    const out = await answerQuestion(ctx.db, rights, ctx.ai, { question: input.question, userId: user.userId, experienceLevel: user.experienceLevel, context: context as never, tableOnly: await isEnabled(ctx.db, 'ai_table_only_mode'), useNarrative: await narrativeAllowed(ctx) }, ctx.clock());
    result = out.result;
    toolCalls = out.tools.calls;
  } catch (err) {
    if (charged) await refund(ctx.db, user.userId, 'ai_questions', ctx.clock());
    throw err;
  }
  onProgress('Checking every number');
  if (charged && ['policy', 'disambiguation', 'clarify', 'not_found'].includes(result.kind)) await refund(ctx.db, user.userId, 'ai_questions', ctx.clock());
  const latency = Date.now() - t0;
  const msg = await ctx.db.one<{ message_id: string }>(
    `INSERT INTO ai.messages (conversation_id, role, content_json, intent, model_id, prompt_version, tool_versions, input_tokens, output_tokens, cost_inr, latency_ms, check_status) VALUES ($1,'assistant',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING message_id`,
    [conv!.conversation_id, JSON.stringify(result), result.intent, result.versions.model, result.versions.prompt, JSON.stringify({ tools: result.versions.tools, pipeline: result.versions.pipeline }), result.usage.input_tokens, result.usage.output_tokens, result.usage.cost_inr, latency, result.check.status],
  );
  for (const c of result.claims) {
    await ctx.db.query(`INSERT INTO ai.claims (message_id, claim_type, text, value, unit, evidence, check_result) VALUES ($1,$2,$3,$4,$5,$6,'pass')`, [msg.message_id, c.type, c.label, c.value, c.unit ?? null, JSON.stringify([c.evidenceId])]);
  }
  for (const t of toolCalls) {
    await ctx.db.query(`INSERT INTO ai.tool_calls (message_id, tool, tool_version, input, output, fields_sent_to_model, fields_withheld, latency_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [msg.message_id, t.tool, TOOL_VERSION, JSON.stringify(t.input), JSON.stringify(t.output ?? null), t.fieldsSent, t.fieldsWithheld, t.ms]);
  }
  const newContext = { ...context, ...(result.context.company_id ? { company_id: result.context.company_id } : {}), ...(result.context.metric ? { metric: result.context.metric } : {}) };
  await ctx.db.query(`UPDATE ai.conversations SET context=$2, updated_at=now() WHERE conversation_id=$1`, [conv!.conversation_id, JSON.stringify(newContext)]);
  if (result.usage.cost_inr > 0) await ctx.db.query(`INSERT INTO ops.cost_ledger (category, amount_inr, reference, details) VALUES ('ai',$1,$2,$3)`, [result.usage.cost_inr, msg.message_id, JSON.stringify({ model: result.versions.model, input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens })]);
  await track(ctx.db, 'ai_answer_delivered', { latency_ms: latency, claims_count: result.claims.length, check_passed: result.check.status !== 'fallback', cost_inr: result.usage.cost_inr }, { userId: user.userId, plan: plan.plan, origin: 'server' });
  await ctx.db.query(`INSERT INTO app.research_history (user_id, kind, ref_id, label) VALUES ($1,'question',$2,$3)`, [user.userId, conv!.conversation_id, input.question.slice(0, 120)]);
  return { conversationId: conv!.conversation_id, messageId: msg.message_id, result, latencyMs: latency };
}

/** AIA-10: alert when the 7-day average cost per answer exceeds the budget by 25%. */
export async function checkAiCost(ctx: AppContext): Promise<{ avg: number; budget: number; alerted: boolean }> {
  const r = await ctx.db.one<{ avg: number | null }>(`SELECT avg(cost_inr)::float8 AS avg FROM ai.messages WHERE role='assistant' AND created_at > now() - interval '7 days' AND intent='research'`);
  const avg = r.avg ?? 0;
  const budget = ctx.cfg.AI_COST_BUDGET_INR_PER_ANSWER;
  const alerted = avg > budget * 1.25;
  if (alerted) await raiseOpsAlert(ctx.db, { kind: 'ai_cost_overrun', severity: 'SEV3', message: `7-day average AI cost per answer ₹${avg.toFixed(2)} exceeds budget ₹${budget} by more than 25%`, dedupeKey: `ai-cost-${new Date().toISOString().slice(0, 10)}` });
  return { avg, budget, alerted };
}
