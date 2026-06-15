import { runScheduledAiRefresh } from "./api/ai/index.js";
import { bootstrap, settleRequiredTaskPenalties } from "./api/utils.js";

export async function schedulerTick(env, now = new Date()) {
  const nowIso = now.toISOString();
  await bootstrap(env);
  const penaltyResult = await settleRequiredTaskPenalties(env, nowIso);
  const aiResult = await runScheduledAiRefresh(env, now);
  return { at: nowIso, ...aiResult, requiredPenalties: penaltyResult };
}
