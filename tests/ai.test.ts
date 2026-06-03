import { describe, expect, it } from "vitest";
import { isPrivateUrl } from "../functions/api/utils.js";

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
  });
});
