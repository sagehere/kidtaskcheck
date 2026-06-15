import { logSystemError } from "./api/utils.js";
import { schedulerTick } from "./scheduler-tick.mjs";
import { createRuntimeEnv } from "./runtime-env.mjs";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 30 * 60 * 1000);
const env = createRuntimeEnv();

async function tick() {
  try {
    const result = await schedulerTick(env);
    console.log(JSON.stringify(result));
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
