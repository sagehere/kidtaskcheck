import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChildApp } from "../src/ChildApp";

describe("ChildApp initial render", () => {
  it("shows only generic loading before the dashboard response", () => {
    const html = renderToStaticMarkup(<ChildApp me={{ type: "child", role: "child", id: "child-1", parentId: "parent-1", displayName: "Child", username: "child" }} refresh={() => {}} />);

    expect(html).toContain("加载中...");
    expect(html).not.toContain("正在准备昨日表现回顾");
    expect(html).not.toContain("daily-review-backdrop");
  });
});
