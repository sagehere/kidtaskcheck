import { runScheduledAiRefresh } from "./api/ai/index.js";
import { bootstrap, maybeRunMaintenance, settleRequiredTaskPenalties, settleTaskSetWindows } from "./api/utils.js";

export async function schedulerTick(env, now = new Date()) {
  const nowIso = now.toISOString();
  await bootstrap(env);
  const penaltyResult = await settleRequiredTaskPenalties(env, nowIso);
  const taskSetWindows = await settleTaskSetWindows(env, nowIso);
  const maintenance = await maybeRunMaintenance(env);
  const aiResult = await runScheduledAiRefresh(env, now);
  return { at: nowIso, ...aiResult, requiredPenalties: penaltyResult, taskSetWindows, maintenance };
}
