import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import fs from "fs"
import path from "path"

const testDir = path.join(import.meta.dir, ".test-env")

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(
    path.join(testDir, "execsa-config.json"),
    JSON.stringify({ enabled: "true", reminder: "true" }),
    "utf-8",
  )
  process.env.OPENCODE_CONFIG_DIR = testDir
})

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

let plugin: any

beforeAll(async () => {
  const modPath = path.join(import.meta.dir, "index.ts")
  delete require.cache[modPath]
  plugin = await import("./index.ts")
})

describe("execsa plugin — config hook", () => {
  test("registers execsa subagent with correct mode and permissions", async () => {
    const hooks = await plugin.default()
    const cfg: any = {}

    await hooks.config(cfg)

    expect(cfg.agent).toBeDefined()
    expect(cfg.agent.execsa).toBeDefined()
    expect(cfg.agent.execsa.mode).toBe("subagent")
    expect(cfg.agent.execsa.hidden).toBe(true)
    expect(cfg.agent.execsa.permission).toEqual({
      "*": "deny",
      bash: "allow",
      external_directory: "allow",
    })
    expect(cfg.agent.execsa.prompt).toContain("truncate large output")
    expect(cfg.agent.execsa.prompt).toContain("30 lines")
  })

  test("uses configured model from execsa-config.json instead of hardcoded default", async () => {
    fs.writeFileSync(
      path.join(testDir, "execsa-config.json"),
      JSON.stringify({ enabled: "true", reminder: "true", model: "openai/gpt-4o-mini" }),
      "utf-8",
    )

    const hooks = await plugin.default()
    const cfg: any = {}
    await hooks.config(cfg)

    expect(cfg.agent.execsa.model).toBe("openai/gpt-4o-mini")

    fs.writeFileSync(
      path.join(testDir, "execsa-config.json"),
      JSON.stringify({ enabled: "true", reminder: "true" }),
      "utf-8",
    )
  })
})

describe("execsa plugin — system.transform hook (enabled gate)", () => {
  test("injects execsa instructions into system prompt when enabled=true", async () => {
    const hooks = await plugin.default()
    const output = { system: [] as string[] }

    await hooks["experimental.chat.system.transform"](
      { model: { providerID: "opencode", modelID: "qwq-plus" } },
      output,
    )

    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("execsa")
  })

  test("skips duplicate injection when already present", async () => {
    const hooks = await plugin.default()
    const output = { system: ["some existing text with <execsaSystemInstructions> mentioned"] }

    await hooks["experimental.chat.system.transform"](
      { model: { providerID: "opencode", modelID: "qwq-plus" } },
      output,
    )

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("some existing text with <execsaSystemInstructions> mentioned")
  })
})

describe("execsa plugin — messages.transform hook (reminder gate)", () => {
  test("injects execsa reminder into user messages when reminder=true", async () => {
    const hooks = await plugin.default()
    const output = {
      messages: [
        { info: { role: "user" }, parts: [] },
      ],
    }

    await hooks["experimental.chat.messages.transform"]({}, output)

    const userMsg = output.messages[0]
    expect(userMsg.parts.length).toBeGreaterThan(0)
    expect(userMsg.parts[0].text).toContain("execsa")
  })

  test("falls back to hardcoded text when prompt store missing", async () => {
    const hooks = await plugin.default()
    const output = {
      messages: [
        { info: { role: "user" }, parts: [] },
      ],
    }

    await hooks["experimental.chat.messages.transform"]({}, output)

    const userMsg = output.messages[0]
    expect(userMsg.parts.length).toBeGreaterThan(0)
    expect(userMsg.parts[0].text).toContain(
      "Do not call execsa multiple times in parallel.",
    )
  })
})

describe("execsa plugin — chat.params hook", () => {
  test("pins temperature to 0 for execsa agent", async () => {
    const hooks = await plugin.default()
    const output = { temperature: 0.7, topP: 1, topK: 1, maxOutputTokens: undefined, options: {} }

    await hooks["chat.params"](
      {
        sessionID: "ses_test",
        agent: "execsa",
        model: { providerID: "opencode", modelID: "qwq-plus" },
        provider: { id: "opencode" },
        message: { role: "user", content: "test" },
      },
      output,
    )

    expect(output.temperature).toBe(0)
  })

  test("does not modify temperature for non-execsa agents", async () => {
    const hooks = await plugin.default()
    const output = { temperature: 0.7, topP: 1, topK: 1, maxOutputTokens: undefined, options: {} }

    await hooks["chat.params"](
      {
        sessionID: "ses_test",
        agent: "build",
        model: { providerID: "opencode", modelID: "qwq-plus" },
        provider: { id: "opencode" },
        message: { role: "user", content: "test" },
      },
      output,
    )

    expect(output.temperature).toBe(0.7)
  })
})

describe("execsa plugin — alwaysExtendLimit", () => {
  function writeExecsaConfig(overrides: Record<string, string>): void {
    const configPath = path.join(testDir, "execsa-config.json")
    fs.writeFileSync(configPath, JSON.stringify(overrides), "utf-8")
  }

  function removeExecsaConfig(): void {
    const configPath = path.join(testDir, "execsa-config.json")
    if (fs.existsSync(configPath)) fs.rmSync(configPath)
  }

  beforeAll(() => {
    process.env.OPENCODE_CONFIG_DIR = testDir
  })

  test("default (no config) sets steps=15", async () => {
    removeExecsaConfig()
    const hooks = await plugin.default()
    const cfg: any = {}
    await hooks.config(cfg)
    expect(cfg.agent.execsa.steps).toBe(15)
  })

  test("always_extend=false sets steps=15", async () => {
    writeExecsaConfig({ always_extend: "false" })
    const hooks = await plugin.default()
    const cfg: any = {}
    await hooks.config(cfg)
    expect(cfg.agent.execsa.steps).toBe(15)
    removeExecsaConfig()
  })

  test("always_extend=true sets steps=200", async () => {
    writeExecsaConfig({ always_extend: "true" })
    const hooks = await plugin.default()
    const cfg: any = {}
    await hooks.config(cfg)
    expect(cfg.agent.execsa.steps).toBe(200)
    removeExecsaConfig()
  })

  test("always_extend=true adds extended capacity instruction in system.transform", async () => {
    writeExecsaConfig({ always_extend: "true" })
    const hooks = await plugin.default()
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"](
      { model: { providerID: "opencode", modelID: "qwq-plus" } },
      output,
    )
    expect(output.system.some((s: string) => s.includes("200 steps"))).toBe(true)
    removeExecsaConfig()
  })

  test("always_extend=false does not add extended capacity instruction in system.transform", async () => {
    removeExecsaConfig()
    const hooks = await plugin.default()
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"](
      { model: { providerID: "opencode", modelID: "qwq-plus" } },
      output,
    )
    expect(output.system.some((s: string) => s.includes("200 steps"))).toBe(false)
  })
})
