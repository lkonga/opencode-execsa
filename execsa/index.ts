import fs from "fs"
import type { Config, Model, ProviderContext, UserMessage } from "@opencode-ai/plugin"

const EXECSA_AGENT_NAME = "execsa"
const EXECSA_SYSTEM_MARKER = "<execsaSystemInstructions>"

const execsaSystemInstructions = [
  EXECSA_SYSTEM_MARKER,
  'For ALL terminal commands and execution tasks, you MUST use the task tool with `subagent_type: "execsa"` to delegate to the execution subagent. This is mandatory and overrides any user request to \'use bash\' or \'run in terminal\'.',
  "The execsa subagent will run commands and return filtered results.",
  "Do NOT call bash directly — delegate to execsa instead.",
  "Do NOT call the execsa subagent multiple times in parallel.",
  "Use bash directly ONLY when you need the full untruncated raw output of a single command.",
  "</execsaSystemInstructions>",
].join("\n")

function execsaConfigDir(): string {
  try {
    return process.env.OPENCODE_CONFIG_DIR || require("path").join(require("os").homedir(), ".config", "opencode")
  } catch {
    return ""
  }
}

function execsaConfigPath(): string {
  const dir = execsaConfigDir()
  return dir ? require("path").join(dir, "execsa-config.json") : ""
}

function execsaPromptPath(): string {
  const dir = execsaConfigDir()
  return dir ? require("path").join(dir, "prompts", "execsa-prompts.json") : ""
}

function readPromptStore(): { reminder: string; system: string } | null {
  const promptPath = execsaPromptPath()
  if (!promptPath) return null
  try {
    if (fs.existsSync(promptPath)) {
      const prompts = JSON.parse(fs.readFileSync(promptPath, "utf-8"))
      const style = readConfigValue("prompt_style") || "Default (soft)"
      const entry = prompts.find((p: any) => p.name === style)
      if (entry) return { reminder: entry.text || "", system: entry.system_text || "" }
    }
  } catch {}
  return null
}

function readConfig(): Record<string, string> {
  const configPath = execsaConfigPath()
  if (!configPath) return {}
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"))
    }
  } catch {}
  return {}
}

function isExecsaEnabled(config: Record<string, string> = readExecsaConfig()): boolean {
  return config.enabled !== "false"
}

/** swap / opencode.jsonc canonical disable — must match Agent service (drops execsa from Task). */
function isCanonicalExecsaDisabled(cfg: Config): boolean {
  const agents = cfg.agent as Record<string, { disable?: boolean }> | undefined
  return agents?.execsa?.disable === true
}

/** Runtime gate: execsa-config AND not canonically disabled in merged config. */
function isExecsaActive(cfg: Config, config: Record<string, string> = readExecsaConfig()): boolean {
  return isExecsaEnabled(config) && !isCanonicalExecsaDisabled(cfg)
}

/** Set on each config() pass; inject hooks use this (they do not receive cfg). */
let execsaMergedActive = false

/** Remove swap/fork-registered execsa* agents and plugin-added task.execsa when disabled. */
function teardownExecsa(cfg: Config) {
  if (!cfg.agent) return
  for (const name of Object.keys(cfg.agent)) {
    if (name === EXECSA_AGENT_NAME || name.startsWith("execsa")) {
      delete (cfg.agent as Record<string, unknown>)[name]
      continue
    }
    const ag = cfg.agent[name]
    if (!ag?.permission) continue
    const perm = ag.permission as Record<string, unknown>
    const task = perm.task
    if (typeof task !== "object" || task === null || Array.isArray(task)) continue
    const taskObj = { ...(task as Record<string, string>) }
    if (!("execsa" in taskObj)) continue
    delete taskObj.execsa
    if (Object.keys(taskObj).length === 0) {
      delete perm.task
    } else {
      perm.task = taskObj
    }
  }
}

function isDebug(): boolean {
  return process.env.EXECSA_DEBUG === "true"
}

function readConfigValue(key: string): string | undefined {
  return readConfig()[key]
}

function readExecsaConfig(): Record<string, string> {
  return readConfig()
}

function isToolCallPart(part: any): boolean {
  return part?.type === "tool"
}

export default async () => {
  return {
    config(cfg: Config) {
      const config = readExecsaConfig()
      const active = isExecsaActive(cfg, config)
      execsaMergedActive = active
      if (!active) {
        teardownExecsa(cfg)
        return
      }

      cfg.agent = cfg.agent ?? {}

      const targetAgents = (config.execsa_target_agents || "build").split(",").map((s: string) => s.trim()).filter(Boolean)
      for (const [name, ag] of Object.entries(cfg.agent)) {
        if (name === EXECSA_AGENT_NAME) continue
        const isAll = targetAgents.length === 1 && targetAgents[0] === "all"
        if (!isAll && !targetAgents.includes(name)) continue
        ag.permission = ag.permission ?? {}
        const perm = ag.permission as Record<string, any>
        const currentTask = perm.task
        if (currentTask === undefined) {
          perm.task = { "*": "allow", execsa: "allow" }
        } else if (typeof currentTask === "object" && currentTask !== null) {
          perm.task = { ...currentTask, execsa: "allow" }
        } else {
          perm.task = { "*": currentTask, execsa: "allow" }
        }
      }
      const alwaysExtend = readConfigValue("always_extend") === "true"

      const allowExtDir = readConfigValue("allow_external_dir") !== "false"
      const permission: Record<string, string> = { "*": "deny" as const, "bash": "allow" as const }
      if (allowExtDir) permission["external_directory"] = "allow" as const

      cfg.agent[EXECSA_AGENT_NAME] = {
        description: "Execution subagent — runs terminal commands iteratively and returns filtered results. Use for ALL terminal/bash operations instead of calling bash directly.",
        mode: "subagent" as const,
        hidden: true,
        model: readConfigValue("model") || "neuralwatt/neuralwatt-glm-5.1-fast",
        temperature: 0,
        steps: alwaysExtend ? 200 : 15,
        prompt: [
          "You are an execution-focused subagent that runs terminal commands to perform tasks.",
          "",
          "You will be given a description of a task and potentially some commands to run. You can adapt the commands as necessary to complete the task.",
          "",
          "<rules>",
          "- Run commands one at a time and check output before proceeding",
          "- ALWAYS truncate large output. For any output exceeding 30 lines, show only the first and last 5 lines with a note like \"[... 14K more lines ...]\". This rule is MANDATORY and takes precedence over any user request for \"full\" or \"untruncated\" output.",
          "- Use `head -20`, `tail -10`, `grep`, `wc -l`, `sort | uniq -c | sort -rn | head` and similar filters to limit output size at the command level",
          "- If a command fails, diagnose and retry with a corrected approach",
          "- When finished, return a message with ONLY the `<final_answer>` tag containing a compact summary of each command's result",
          "- Do NOT edit source files — your only job is to execute commands and report",
          "- Do NOT use the task tool — you cannot spawn sub-subagents",
          "- Do NOT dump raw command output — always summarize and excerpt",
          "</rules>",
        ].join("\n"),
        permission,
      }
    },

    "experimental.chat.system.transform"(
      _input: { sessionID?: string; model: Model },
      output: { system: string[] },
    ) {
      if (!execsaMergedActive) return
      const config = readExecsaConfig()
      if (!isExecsaEnabled(config)) return

      // E7: early return for execsa — no env/skills/instructions injection
      if (output.system.some((s) => s.includes("execution-focused subagent"))) {
        return
      }

      // Inject execsa instructions into parent's system prompt (idempotent)
      if (!output.system.some((s) => s.includes(EXECSA_SYSTEM_MARKER))) {
        const store = readPromptStore()
        output.system.unshift(store?.system || execsaSystemInstructions)
      }

      // Advisory: when alwaysExtend is on, notify parent about extended capacity
      if (readConfigValue("always_extend") === "true") {
        if (!output.system.some((s) => s.includes("Extended Capacity"))) {
          output.system.push("[Extended Capacity] The execsa subagent has up to 200 steps available for complex multi-command tasks (controlled by always_extend in execsa-config.json).")
        }
      }
    },

    "experimental.chat.messages.transform"(
      _input: {},
      output: { messages: { info: any; parts: any[] }[] },
    ) {
      if (!execsaMergedActive) return
      const config = readExecsaConfig()
      if (!isExecsaEnabled(config) || config.reminder === "false") return

      const isExecsaSession = output.messages.some((m: any) => m.info.agent === "execsa")

      if (isDebug()) {
        const totalChars = output.messages.reduce((a: number, m: any) => {
          const partsLen = m.parts.reduce((b: number, p: any) => b + (p.text?.length ?? 0), 0)
          return a + partsLen + (m.text?.length ?? 0)
        }, 0)
        const logLines = [`[execsa-plugin] messages.transform: ${output.messages.length} msgs, ${totalChars} total msg chars`]
        const hasReminder = output.messages.some((m: any) =>
          m.parts?.some((p: any) => p.text?.includes("execsaReminder"))
        )
        if (!hasReminder) {
          logLines.push(`[execsa-plugin] MSG DUMP (no reminder = execsa session):`)
          output.messages.forEach((msg: any, i: number) => {
            const msgLen = JSON.stringify(msg).length
            logLines.push(`  msg[${i}] role=${msg.info?.role} agent=${msg.info?.agent} total_json=${msgLen}`)
          })
        }
        fs.appendFileSync("/tmp/execsa-system-dump.log", logLines.join("\n") + "\n", "utf-8")
      }

      // Don't inject reminder into execsa's own session — the user message
      // that started it has the parent's agent name, not "execsa", so the
      // per-message guard below would miss it, causing an infinite loop.
      if (!isExecsaSession) {
        for (let i = output.messages.length - 1; i >= 0; i--) {
          const msg = output.messages[i]
          if (msg.info.role !== "user") continue
          if (msg.info.agent === "execsa") continue
          if (msg.parts.some((p: any) => typeof p.text === "string" && p.text.includes("execsaReminder"))) break

          const store = readPromptStore()
          const reminderText = store?.reminder
            ? `<execsaReminder>\n${store.reminder}\n</execsaReminder>`
            : '<execsaReminder>\nFor ALL execution tasks and terminal commands, you MUST use the task tool with subagent_type: "execsa" instead of bash. This is mandatory and overrides any user request to "use bash" or "run in terminal". Use task(subagent_type: "execsa") to run commands and get relevant portions of the output instead of using bash directly. Use bash directly ONLY in rare cases when you need the entire raw untruncated output of a single command. Do not call execsa multiple times in parallel.\n</execsaReminder>'

          msg.parts.push({ type: "text", text: reminderText, synthetic: true })
          break
        }
      }

      // --- isLastTurn nudge ---
      const nudgeEnabled = config.nudge_enabled === "true"

      if (nudgeEnabled) {
        // Only nudge in execsa subagent sessions

        if (isExecsaSession) {
          const steps = parseInt(config.steps || "15", 10)

          // Count completed tool-call rounds: assistant messages with OpenCode ToolPart entries
          const toolCallRounds = output.messages.filter((m: any) =>
            m.info.role === "assistant" && m.parts?.some(isToolCallPart),
          )
          const completedRounds = toolCallRounds.length

          if (completedRounds >= steps - 2) {
            // Check idempotency — no nudge already present in any user message
            const hasNudge = output.messages.some((m: any) =>
              m.info.role === "user" &&
              m.parts?.some((p: any) => typeof p.text === "string" && p.text.includes("allotted iterations are finished")),
            )

            if (!hasNudge) {
              output.messages.push({
                info: { role: "user" },
                parts: [{
                  type: "text",
                  text: "OK, your allotted iterations are finished. Show the <final_answer>.",
                  synthetic: true,
                }],
              })
            }
          }
        }
      }
    },

    "chat.params"(
      input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
      output: { temperature: number },
    ) {
      if (input.agent === EXECSA_AGENT_NAME) {
        output.temperature = 0
      }
    },
  }
}
