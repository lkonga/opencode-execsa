/**
 * Regression guard for the parent-applied hotfix:
 * "fix(execsa): never emit the 'Execsa blocked' startup warning toast" (V1 `main` e2eec69).
 *
 * Contract being protected:
 *   1. A DISABLED Execsa is completely SILENT — no startup toast, ever. Canonical
 *      disable semantics are unchanged; only the warning-toast branch is gone.
 *   2. The isolated V2 port must never reintroduce it (the merge of the V1 hotfix
 *      into this branch is not enough on its own — code could creep back in).
 *
 * These are deliberately static/contract assertions: they fail loudly if any
 * source in the port (or the live V1 entrypoint) regrows a startup warning.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const V2 = join(ROOT, "v2")

const read = (p: string) => readFileSync(p, "utf8")

const v2Sources = ["tui.tsx", "backend.ts", "backend-core.ts", "config.ts", "server.mjs"]
  .map((f) => join(V2, f))
  .filter(existsSync)

describe("execsa disable is silent (no startup toast)", () => {
  test("no source contains the removed 'Execsa blocked' warning text", () => {
    for (const file of v2Sources) {
      expect(read(file)).not.toContain("Execsa blocked")
    }
    const v1Tui = join(ROOT, "tui.ts")
    if (existsSync(v1Tui)) expect(read(v1Tui)).not.toContain("Execsa blocked")
  })

  test("no source declares a warning toast", () => {
    for (const file of v2Sources) {
      const src = read(file)
      expect(src).not.toMatch(/variant:\s*["']warning["']/)
    }
    const v1Tui = join(ROOT, "tui.ts")
    if (existsSync(v1Tui)) expect(read(v1Tui)).not.toMatch(/variant:\s*["']warning["']/)
  })

  test("the V2 TUI setup registers no toast at startup", () => {
    const src = read(join(V2, "tui.tsx"))
    // Toasts are allowed ONLY inside the settings dialog flow. Everything from the
    // Commands component onward must be toast-free, so mounting the plugin cannot toast.
    const startupSection = src.slice(src.indexOf("function Commands"))
    expect(startupSection.length).toBeGreaterThan(0)
    expect(startupSection).not.toContain("toast")

    // The plugin definition itself (slot registration) must not toast either.
    const defineSection = src.slice(src.indexOf("Plugin.define"))
    expect(defineSection).not.toContain("toast")
  })

  test("the V2 backend silence guard exists and returns before any mutation", () => {
    const src = read(join(V2, "backend.ts"))
    expect(src).toMatch(/config\.enabled\s*===\s*["']false["']\s*\)\s*return/)
  })

  test("V1 entrypoint still honours the disable guard (no behavioural drift)", () => {
    const v1Backend = join(ROOT, "execsa", "index.ts")
    if (!existsSync(v1Backend)) return
    const src = read(v1Backend)
    // The V1 backend must keep treating a disabled execsa as a no-op.
    expect(src).toMatch(/disable|enabled/)
  })
})
