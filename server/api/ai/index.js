export {
    AI_FETCH_TIMEOUT_MS, AI_MAX_OUTPUT_LENGTH, AiProviderError,
    truncateAiOutput, stripAiThinking, detectProvider,
    listModels, callParentAiService, callParentAiServiceForReport, callParentImageService,
} from "./providers.js";

export {
    DEFAULT_WEEKLY_REPORT_PROMPT, DEFAULT_MONTHLY_REPORT_PROMPT,
    buildAiPrompt, buildDailyGreetingPrompt, buildReportAiPrompt, previousDayReportSummary, previousWeekReportSummary,
} from "./prompt.js";

export {
    aiConfigHash, aiReportConfigHash, aiImageConfigHash,
    getParentAiServiceConfig, loadAiGreetingSnapshot,
    ensureParentAiServiceSettings, ensureAiReportCommentaries,
} from "./cache.js";

export {
    generateParentAiGreeting, generateReportCommentary, generateCartoonReportImage, generatePrintChecklistImage, generateScheduleImage,
    previousCompletedReportRange, collectReportData, collectReportComparison, buildCartoonReportPrompt,
} from "./orchestrator.js";

export {
    ensureAiScheduledRefreshRuns, runScheduledAiRefresh,
} from "./scheduled.js";

export {
    ensureAiGenerationQueue, enqueueScheduledAiJobs, processAiGenerationQueue,
} from "./queue.js";

export {
    ensureAiCartoonReportJobs, enqueueCartoonReportJob, loadCartoonReportJob,
    publicCartoonJob, processCartoonReportJobs,
    ensureAiPrintChecklistImageJobs, enqueuePrintChecklistImageJob, loadPrintChecklistImageJob,
    publicPrintChecklistJob, processPrintChecklistImageJobs,
    ensureAiScheduleImageJobs, enqueueScheduleImageJob, loadScheduleImageJob,
    publicScheduleImageJob, processScheduleImageJobs,
} from "./cartoon-queue.js";
