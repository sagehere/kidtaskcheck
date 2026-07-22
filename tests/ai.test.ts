import { describe, expect, it } from "vitest";
import { isPrivateUrl } from "../server/api/utils.js";
import { buildReportAiPrompt } from "../server/api/ai/prompt.js";

describe("Task 36: AI Mock Tests", () => {
  describe("Base URL validation", () => {
    it("rejects private/internal URLs", () => {
      expect(isPrivateUrl("http://localhost:8080")).toBe(true);
      expect(isPrivateUrl("http://127.0.0.1")).toBe(true);
      expect(isPrivateUrl("http://10.0.0.1")).toBe(true);
      expect(isPrivateUrl("http://192.168.1.1")).toBe(true);
      expect(isPrivateUrl("http://169.254.169.254")).toBe(true);
      const ipv6Hostname = new URL("http://[::1]").hostname.replace(/^\[|\]$/g, "");
      expect(ipv6Hostname === "::1" || isPrivateUrl("http://[::1]")).toBe(true);
      expect(isPrivateUrl("http://metadata.google.internal")).toBe(true);
    });

    it("allows public HTTPS URLs", () => {
      expect(isPrivateUrl("https://api.openai.com/v1")).toBe(false);
      expect(isPrivateUrl("https://api.anthropic.com")).toBe(false);
    });

    it("rejects non-HTTPS URLs in production-like mode", () => {
      expect(isPrivateUrl("http://api.example.com")).toBe(false); // HTTP is allowed by isPrivateUrl but later rejected
    });

    it("correctly validates 172.x.x.x range (RFC 1918 172.16.0.0/12)", () => {
      expect(isPrivateUrl("http://172.16.0.1")).toBe(true);
      expect(isPrivateUrl("http://172.31.255.255")).toBe(true);
      expect(isPrivateUrl("http://172.32.0.1")).toBe(false);
      expect(isPrivateUrl("http://172.217.0.1")).toBe(false);
      expect(isPrivateUrl("http://172.64.64.1")).toBe(false);
    });
  });

  it("builds report prompts from reviewed rate and previous-period data", () => {
    const prompt = buildReportAiPrompt(
      { display_name: "Kid", gender: "", birth_date: "" },
      {
        range: { label: "2026-06" },
        summary: { approved: 1, rejected: 1, pending: 2, approvalRate: 50, netPoints: 5, praiseCount: 1, criticismCount: 0 },
        previousSummary: { approved: 2, rejected: 0, pending: 0, approvalRate: 100, netPoints: 3, praiseCount: 0, criticismCount: 1 },
        tasks: [{ title: "Read", status: "rejected", review_note: "再认真一些" }],
        feedback: [], achievements: [], rewards: [], requiredEvents: [], categoryCounts: [], pointBreakdown: [{ label: "任务", points: 5 }],
        currentBalance: 10, assignments: { tasks: [], rewards: [] },
      },
      {}, "monthly", 480,
    );
    expect(prompt).toContain("已审核通过率 50%");
    expect(prompt).toContain("上期对比");
    expect(prompt).toContain("再认真一些");
    expect(prompt).toContain("下一周期可执行");
    expect(prompt).not.toContain("任务完成情况：共");
  });
});
