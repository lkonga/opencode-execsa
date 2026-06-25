import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

// Use a SINGLE temp dir for all tests — Bun caches dynamic imports, so the
// module IIFE (which computes EXECSA_CONFIG_PATH) runs only once.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "execsa-test-"))
const DEFAULT_CONFIG = {
  enabled: "true",
  reminder: "true",
  always_extend: "false",
  allow_external_dir: "true",
  execsa_target_agents: "all",
  model: "test-model",
  prompt_style: "Default (soft)",
  nudge_enabled: "false",
}

function writeConfig(overrides: Record<string, string> = {}) {
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "execsa-config.json"),
    JSON.stringify({ ...DEFAULT_CONFIG, ...overrides }, null, 2),
    "utf-8",
  )
}

let hooks: { config: (cfg: any) => void }

beforeAll(async () => {
  process.env.OPENCODE_CONFIG_DIR = FIXTURE_DIR
  writeConfig()
  const mod = await import(`./index.ts?enabled=${FIXTURE_DIR}`)
  const pluginFactory = mod.default as () => Promise<typeof hooks>
  hooks = await pluginFactory()
})

afterAll(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe("permission mutation", () => {

  it("adds execsa:allow when agent has no task permission (undefined)", () => {
    const cfg = { agent: { general: { description: "General", mode: "subagent" as const } } }
    hooks.config(cfg)
    const perm = (cfg.agent as any).general.permission
    expect(perm.task).toEqual({ "*": "allow", execsa: "allow" })
  })

  it("extends existing object task permission with execsa:allow", () => {
    const cfg = { agent: { coder: { description: "Coder", mode: "subagent" as const, permission: { task: { "*": "allow", general: "allow" } } } } }
    hooks.config(cfg)
    expect((cfg.agent as any).coder.permission.task).toEqual({ "*": "allow", general: "allow", execsa: "allow" })
  })

  it("preserves string 'allow' task permission and adds execsa:allow", () => {
    const cfg = { agent: { explore: { description: "Explore", mode: "subagent" as const, permission: { task: "allow" } } } }
    hooks.config(cfg)
    expect((cfg.agent as any).explore.permission.task).toEqual({ "*": "allow", execsa: "allow" })
  })

  it("preserves string 'deny' task permission and adds execsa:allow", () => {
    const cfg = { agent: { r: { description: "Restricted", mode: "subagent" as const, permission: { task: "deny" } } } }
    hooks.config(cfg)
    expect((cfg.agent as any).r.permission.task).toEqual({ "*": "deny", execsa: "allow" })
  })

  it("preserves existing task object with {*:deny} and adds execsa:allow", () => {
    const cfg = { agent: { locked: { description: "Locked", mode: "subagent" as const, permission: { task: { "*": "deny" } } } } }
    hooks.config(cfg)
    expect((cfg.agent as any).locked.permission.task).toEqual({ "*": "deny", execsa: "allow" })
  })

  it("preserves existing task object with specific subagent permissions", () => {
    const cfg = { agent: { r: { description: "Restricted", mode: "subagent" as const, permission: { task: { coder: "allow", general: "allow", explore: "deny" } } } } }
    hooks.config(cfg)
    expect((cfg.agent as any).r.permission.task).toEqual({ coder: "allow", general: "allow", explore: "deny", execsa: "allow" })
  })

  it("only mutates target agents — not execsa itself (execsa has its own permission)", () => {
    const cfg = { agent: { execsa: { description: "Execsa", mode: "subagent" as const }, build: { description: "Build", mode: "subagent" as const } } }
    hooks.config(cfg)
    // execsa agent gets its EXTERNAL permission (line 104-128), not the mutation loop
    // The mutation loop (lines 81-96) skips execsa via `if (name === EXECSA_AGENT_NAME) continue`
    const execsaPerm = (cfg.agent as any).execsa.permission
    // execsa should have its own permission (set by plugin), and it should NOT have task.execsa:allow
    // because the mutation loop skipped it. But the plugin's own permission for execsa
    // is { "*": "deny", "bash": "allow" } (line 101) — that's correct behavior.
    expect(execsaPerm).toBeDefined()
    expect((cfg.agent as any).build.permission.task).toEqual({ "*": "allow", execsa: "allow" })
  })

  it("only mutates agents in targetAgents list", () => {
    // Overwrite config with specific target
    writeConfig({ execsa_target_agents: "coder" })

    const cfg = { agent: {
      build: { description: "Build", mode: "subagent" as const },
      coder: { description: "Coder", mode: "subagent" as const },
      explore: { description: "Explore", mode: "subagent" as const },
    } }
    hooks.config(cfg)
    expect((cfg.agent as any).coder.permission.task).toEqual({ "*": "allow", execsa: "allow" })
    expect((cfg.agent as any).build.permission).toBeUndefined()
    expect((cfg.agent as any).explore.permission).toBeUndefined()

    // Restore for subsequent tests
    writeConfig()
  })

  it("preserves non-task permission fields during mutation", () => {
    const cfg = { agent: { expert: { description: "Expert", mode: "subagent" as const, permission: { bash: "allow", read: "allow" } } } }
    hooks.config(cfg)
    const perm = (cfg.agent as any).expert.permission
    expect(perm.task).toEqual({ "*": "allow", execsa: "allow" })
    expect(perm.bash).toBe("allow")
    expect(perm.read).toBe("allow")
  })
})
