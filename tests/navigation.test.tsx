import { renderToStaticMarkup } from "react-dom/server";
import { Home, ListTodo } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Shell } from "../src/components/Shell";

describe("Shell navigation", () => {
  it("renders desktop and mobile navigation with the active destination", () => {
    const html = renderToStaticMarkup(
      <Shell
        me={{ type: "user", role: "parent", id: "parent-1", displayName: "Parent", username: "parent" }}
        refresh={() => {}}
        navigation={[
          { value: "today", label: "今日", icon: <Home /> },
          { value: "rules", label: "规则", icon: <ListTodo /> }
        ]}
        activeNavigation="today"
        onNavigate={() => {}}
      >
        <div>content</div>
      </Shell>
    );

    expect(html).toContain("primary-navigation");
    expect(html).toContain("mobile-navigation");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("今日");
    expect(html).toContain("规则");
  });
});
