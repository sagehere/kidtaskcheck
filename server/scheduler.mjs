import { runScheduledAiRefresh } from "./api/ai/index.js";
import { bootstrap, logSystemError } from "./api/utils.js";
import { createRuntimeEnv } from "./runtime-env.mjs";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 30 * 60 * 1000);
const env = createRuntimeEnv();

async function tick() {
  try {
    await bootstrap(env);
    const result = await runScheduledAiRefresh(env, new Date());
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  } catch (error) {
    console.error("scheduled refresh failed:", error?.stack || error);
    await logSystemError(env, {
      source: "scheduler",
      message: error?.message || String(error || "scheduled refresh failed"),
      stack: error?.stack || "",
      status: 500
    });
  }
}

await tick();
setInterval(() => void tick(), intervalMs);
