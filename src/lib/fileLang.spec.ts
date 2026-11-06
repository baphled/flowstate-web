import { describe, expect, it } from "vitest";
import { resolveFileLang } from "./fileLang";

describe("resolveFileLang", () => {
  it.each([
    ["/tmp/example.ts", "typescript"],
    ["src/App.vue", undefined],
    ["/tmp/main.go", "go"],
    ["src/app.py", "python"],
    ["data/config.json", "json"],
    ["run.sh", "bash"],
    ["install.bash", "bash"],
    ["README.md", "markdown"],
    ["script.ps1", "powershell"],
    ["main.zig", "zig"],
    ["src/app.js", "javascript"],
    ["src/app.tsx", "typescript"],
    ["/tmp/no_extension", undefined],
    ["", undefined],
  ])("resolves %s to %s", (filePath, expected) => {
    expect(resolveFileLang(filePath)).toBe(expected);
  });

  it("is case-insensitive for the extension", () => {
    expect(resolveFileLang("/tmp/App.TS")).toBe("typescript");
  });
});
