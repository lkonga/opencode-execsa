import type { ExecsaConfig } from "./config"

export const EXECSA_AGENT = "execsa"
export const EXECSA_SYSTEM_MARKER = "<execsaSystemInstructions>"

export type PermissionRule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

export const execsaSystemInstructions = [
  EXECSA_SYSTEM_MARKER,
  'For ALL terminal commands and execution tasks, you MUST use the subagent tool with `subagent_type: "execsa"`.',
  "Do NOT call shell directly unless one command requires complete untruncated raw output.",
  "Do NOT call the execsa subagent multiple times in parallel.",
  "</execsaSystemInstructions>",
].join("\n")

export const execsaAgentSystem = [
  "You are an execution-focused subagent that runs terminal commands to perform tasks.",
  "",
  "<rules>",
  "- Run commands one at a time and check output before proceeding",
  "- ALWAYS truncate large output. For output exceeding 30 lines, show only the first and last 5 lines and report how much was omitted.",
  "- Filter output at the command level whenever possible",
  "- If a command fails, diagnose and retry with a corrected approach",
  "- When finished, return only a compact summary of each command's result",
  "- Do NOT edit source files",
  "- Do NOT use the subagent tool",
  "- Do NOT dump raw command output",
  "</rules>",
].join("\n")

/** V2 permissions are ordered rules. Preserve every rule and append only the exact execsa allow. */
export function addExecsaAllow(rules: PermissionRule[]) {
  rules.push({ action: "subagent", resource: EXECSA_AGENT, effect: "allow" })
}

export function targetAgents(config: ExecsaConfig) {
  return (config.execsa_target_agents || "build").split(",").map((name) => name.trim()).filter(Boolean)
}

function modelRef(value: string) {
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return undefined
  return { providerID: value.slice(0, separator), id: value.slice(separator + 1) }
}

function positiveSteps(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

type AgentInfo = {
  id: string
  name: string
  model?: { providerID: string; id: string }
  request: { settings: Record<string, unknown>; headers: Record<string, string>; body: Record<string, unknown> }
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  steps?: number
  permissions: PermissionRule[]
}

export type AgentDraft = {
  list(): AgentInfo[]
  update(id: string, update: (agent: AgentInfo) => void): void
  remove(id: string): void
}

export function configureAgents(draft: AgentDraft, config: ExecsaConfig) {
  if (config.enabled === "false") {
    draft.remove(EXECSA_AGENT)
    return
  }

  const targets = targetAgents(config)
  const all = targets.length === 1 && targets[0] === "all"
  for (const agent of draft.list()) {
    if (agent.id === EXECSA_AGENT || (!all && !targets.includes(agent.id))) continue
    draft.update(agent.id, (item) => addExecsaAllow(item.permissions))
  }

  draft.update(EXECSA_AGENT, (agent) => {
    agent.name = "Execsa"
    agent.description = "Execution subagent — runs terminal commands iteratively and returns filtered results."
    agent.mode = "subagent"
    agent.hidden = false
    agent.system = execsaAgentSystem
    agent.steps = config.always_extend === "true" ? 200 : positiveSteps(config.steps, 15)
    agent.request.body.temperature = 0
    agent.model = modelRef(config.model || "")
    agent.permissions.length = 0
    agent.permissions.push(
      { action: "*", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "allow" },
    )
    if (config.allow_external_dir !== "false") {
      agent.permissions.push({ action: "external_directory", resource: "*", effect: "allow" })
    }
  })
}

export function reminderText(custom?: string) {
  return custom
    ? `<execsaReminder>\n${custom}\n</execsaReminder>`
    : '<execsaReminder>\nFor ALL execution tasks and terminal commands, use the subagent tool with subagent_type: "execsa" instead of shell. Do not call execsa multiple times in parallel.\n</execsaReminder>'
}
