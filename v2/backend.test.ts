import { describe, expect, it } from "bun:test"
import { addExecsaAllow, configureAgents, type AgentDraft, type PermissionRule } from "./backend-core"
import { DEFAULT_CONFIG } from "./config"

function effect(rules: PermissionRule[], resource: string) {
  return [...rules].reverse().find((rule) =>
    (rule.action === "*" || rule.action === "subagent") && (rule.resource === "*" || rule.resource === resource),
  )?.effect
}

function rules(...input: PermissionRule[]) {
  const before = structuredClone(input)
  addExecsaAllow(input)
  return { before, after: input }
}

describe("V2 permission mutation", () => {
  it("preserves allow-all when no task/subagent rule existed", () => {
    const result = rules({ action: "*", resource: "*", effect: "allow" })
    expect(result.after.slice(0, -1)).toEqual(result.before)
    expect(effect(result.after, "general")).toBe("allow")
    expect(effect(result.after, "execsa")).toBe("allow")
  })

  it("preserves string-equivalent subagent allow", () => {
    const result = rules({ action: "subagent", resource: "*", effect: "allow" })
    expect(result.after.slice(0, -1)).toEqual(result.before)
    expect(effect(result.after, "general")).toBe("allow")
  })

  it("preserves string-equivalent subagent deny while allowing execsa", () => {
    const result = rules({ action: "subagent", resource: "*", effect: "deny" })
    expect(effect(result.after, "general")).toBe("deny")
    expect(effect(result.after, "execsa")).toBe("allow")
  })

  it("preserves object-equivalent wildcard deny while allowing execsa", () => {
    const result = rules({ action: "subagent", resource: "*", effect: "deny" })
    expect(result.after[0]).toEqual(result.before[0])
    expect(result.after.at(-1)).toEqual({ action: "subagent", resource: "execsa", effect: "allow" })
  })

  it("preserves specific subagent permissions", () => {
    const result = rules(
      { action: "subagent", resource: "coder", effect: "allow" },
      { action: "subagent", resource: "explore", effect: "deny" },
    )
    expect(result.after.slice(0, -1)).toEqual(result.before)
    expect(effect(result.after, "coder")).toBe("allow")
    expect(effect(result.after, "explore")).toBe("deny")
  })

  it("preserves non-subagent permissions", () => {
    const result = rules(
      { action: "shell", resource: "*", effect: "ask" },
      { action: "read", resource: "*", effect: "allow" },
    )
    expect(result.after.slice(0, -1)).toEqual(result.before)
  })
})

function agent(id: string, permissions: PermissionRule[] = []): any {
  return {
    id, name: id, request: { settings: {}, headers: {}, body: {} }, mode: "primary", hidden: false, permissions,
  }
}

function draft(input: any[]) {
  const agents = new Map(input.map((item) => [item.id, item]))
  const api: AgentDraft = {
    list: () => [...agents.values()],
    update: (id, update) => {
      if (!agents.has(id)) agents.set(id, agent(id, [{ action: "*", resource: "*", effect: "allow" }]))
      update(agents.get(id))
    },
    remove: (id) => { agents.delete(id) },
  }
  return { agents, api }
}

describe("V2 agent transform", () => {
  it("only adds execsa allow to selected targets and never to execsa itself", () => {
    const fixture = draft([agent("build"), agent("coder"), agent("execsa")])
    configureAgents(fixture.api, { ...DEFAULT_CONFIG, execsa_target_agents: "coder" })
    expect(fixture.agents.get("build").permissions).toEqual([])
    expect(fixture.agents.get("coder").permissions).toEqual([
      { action: "subagent", resource: "execsa", effect: "allow" },
    ])
    expect(fixture.agents.get("execsa").permissions).not.toContainEqual(
      { action: "subagent", resource: "execsa", effect: "allow" },
    )
  })

  it("keeps other target rules and configures execsa through V2 fields", () => {
    const existing = [{ action: "shell", resource: "git status", effect: "allow" }] as PermissionRule[]
    const before = structuredClone(existing)
    const fixture = draft([agent("build", existing)])
    configureAgents(fixture.api, { ...DEFAULT_CONFIG, execsa_target_agents: "all", model: "provider/model" })
    expect(fixture.agents.get("build").permissions.slice(0, -1)).toEqual(before)
    expect(fixture.agents.get("execsa")).toMatchObject({
      model: { providerID: "provider", id: "model" },
      mode: "subagent",
      hidden: true,
      steps: 15,
      request: { body: { temperature: 0 } },
    })
  })

  it("removes execsa and leaves every other agent untouched when disabled", () => {
    const build = agent("build", [{ action: "subagent", resource: "*", effect: "deny" }])
    const fixture = draft([build, agent("execsa")])
    configureAgents(fixture.api, { ...DEFAULT_CONFIG, enabled: "false", execsa_target_agents: "all" })
    expect(fixture.agents.has("execsa")).toBe(false)
    expect(fixture.agents.get("build")).toBe(build)
    expect(build.permissions).toEqual([{ action: "subagent", resource: "*", effect: "deny" }])
  })
})
