import { runScheduledAiRefresh } from "../functions/api/ai/index.js";
import { bootstrap } from "../functions/api/utils.js";

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            await bootstrap(env);
            await runScheduledAiRefresh(env, new Date(event.scheduledTime));
        })());
    }
};
