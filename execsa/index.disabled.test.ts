import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "execsa-disabled-test-"))

function writeConfig(overrides: Record<string, string> = {}) {
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "execsa-config.json"),
    JSON.stringify({
      enabled: "false",
      reminder: "false",
      always_extend: "false",
      allow_external_dir: "true",
      execsa_target_agents: "all",
      model: "test-model",
      prompt_style: "Default (soft)",
      nudge_enabled: "false",
      ...overrides,
    }, null, 2),
    "utf-8",
  )
}

let hooks: any

beforeAll(async () => {
  process.env.OPENCODE_CONFIG_DIR = FIXTURE_DIR
  writeConfig()
  const mod = await import("./index.ts")
  const pluginFactory = mod.default as () => Promise<any>
  hooks = await pluginFactory()
})

afterAll(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe("execsa disabled (enabled=false)", () => {
  it("config() returns immediately — no agent registered", () => {
    const cfg = { agent: { build: { description: "Build", mode: "subagent" as const } } }
    hooks.config(cfg)
    expect((cfg.agent as any).execsa).toBeUndefined()
  })

  it("config() does not mutate target agents' permissions", () => {
    const cfg = { agent: { build: { description: "Build", mode: "subagent" as const } } }
    hooks.config(cfg)
    expect((cfg.agent as any).build.permission).toBeUndefined()
  })

  it("system.transform does not inject execsaSystemInstructions", () => {
    const output = { system: ["You are a helpful assistant."] }
    hooks["experimental.chat.system.transform"]({}, output)
    const hasMarker = output.system.some((s: string) => s.includes("<execsaSystemInstructions>"))
    expect(hasMarker).toBe(false)
  })

  it("messages.transform does not inject execsaReminder", () => {
    const output = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }] }
    hooks["experimental.chat.messages.transform"]({}, output)
    const hasReminder = output.messages[0].parts.some((p: any) =>
      typeof p.text === "string" && p.text.includes("execsaReminder"),
    )
    expect(hasReminder).toBe(false)
  })

  it("chat.params still pins temperature for execsa agent (harmless — agent not registered)", () => {
    const input = { sessionID: "s1", agent: "execsa", model: {}, provider: {}, message: {} }
    const output = { temperature: 0.7 }
    hooks["chat.params"](input, output)
    expect(output.temperature).toBe(0)
  })
})
