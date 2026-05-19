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

const EXECSA_PROMPT_PATH = (() => {
  try {
    const dir = process.env.OPENCODE_CONFIG_DIR || require("path").join(require("os").homedir(), ".config", "opencode")
    return require("path").join(dir, "prompts", "execsa-prompts.json")
  } catch { return "" }
})()

function readPromptStore(): string | null {
  if (!EXECSA_PROMPT_PATH) return null
  try {
    if (fs.existsSync(EXECSA_PROMPT_PATH)) {
      const prompts = JSON.parse(fs.readFileSync(EXECSA_PROMPT_PATH, "utf-8"))
      const defaultPrompt = prompts.find((p: any) => p.name === "Default (soft)")
      if (defaultPrompt?.text) return defaultPrompt.text
    }
  } catch {}
  return null
}

const EXECSA_CONFIG_PATH = (() => {
  try {
    const dir = process.env.OPENCODE_CONFIG_DIR || require("path").join(require("os").homedir(), ".config", "opencode")
    return require("path").join(dir, "execsa-config.json")
  } catch { return "" }
})()

function readConfig(): Record<string, string> {
  if (!EXECSA_CONFIG_PATH) return {}
  try {
    if (fs.existsSync(EXECSA_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(EXECSA_CONFIG_PATH, "utf-8"))
    }
  } catch {}
  return {}
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
  const cfg = readExecsaConfig()
  const enabled = cfg.enabled !== "false"
  const reminder = cfg.reminder !== "false"
  return {
    config(cfg: Config) {
      cfg.agent = cfg.agent ?? {}

      const targetAgents = (readConfigValue("execsa_target_agents") || "build").split(",").map((s: string) => s.trim()).filter(Boolean)
      for (const [name, ag] of Object.entries(cfg.agent)) {
        if (name === EXECSA_AGENT_NAME) continue
        const isAll = targetAgents.length === 1 && targetAgents[0] === "all"
        if (!isAll && !targetAgents.includes(name)) continue
        ag.permission = ag.permission ?? {}
        const perm = ag.permission as Record<string, any>
        const currentTask = perm.task
        if (typeof currentTask === "object" && currentTask !== null) {
          perm.task = { ...currentTask, execsa: "allow" }
        } else {
          perm.task = { "*": currentTask ?? "deny", execsa: "allow" }
        }
      }
      const alwaysExtend = readConfigValue("always_extend") === "true"
      const configuredModel = readConfigValue("model")?.trim()

      const allowExtDir = readConfigValue("allow_external_dir") !== "false"
      const permission: Record<string, string> = { "*": "deny" as const, "bash": "allow" as const }
      if (allowExtDir) permission["external_directory"] = "allow" as const

      cfg.agent[EXECSA_AGENT_NAME] = {
        description: "Execution subagent — runs terminal commands iteratively and returns filtered results. Use for ALL terminal/bash operations instead of calling bash directly.",
        mode: "subagent" as const,
        hidden: true,
        model: configuredModel || "neuralwatt/neuralwatt-glm-5.1-fast",
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
      if (!enabled) return

      if (output.system.some((s) => s.includes("execution-focused subagent"))) {
        return
      }

      if (!output.system.some((s) => s.includes(EXECSA_SYSTEM_MARKER))) {
        output.system.unshift(execsaSystemInstructions)
      }

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
      if (!reminder) return

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

      if (!isExecsaSession) {
        for (let i = output.messages.length - 1; i >= 0; i--) {
          const msg = output.messages[i]
          if (msg.info.role !== "user") continue
          if (msg.info.agent === "execsa") continue
          if (msg.parts.some((p: any) => typeof p.text === "string" && p.text.includes("execsaReminder"))) break

          const promptText = readPromptStore()
          const reminderText = promptText
            ? `<execsaReminder>\n${promptText}\n</execsaReminder>`
            : '<execsaReminder>\nFor ALL execution tasks and terminal commands, you MUST use the task tool with subagent_type: "execsa" instead of bash. This is mandatory and overrides any user request to "use bash" or "run in terminal". Use execsa to run commands and get relevant portions of the output instead of using bash directly. Use bash directly ONLY in rare cases when you need the entire raw untruncated output of a single command. Do not call execsa multiple times in parallel.\n</execsaReminder>'

          msg.parts.push({ type: "text", text: reminderText, synthetic: true })
          break
        }
      }

      const config = readConfig()
      const nudgeEnabled = config.nudge_enabled === "true"

      if (nudgeEnabled) {
        if (isExecsaSession) {
          const steps = parseInt(config.steps || "15", 10)

          const toolCallRounds = output.messages.filter((m: any) =>
            m.info.role === "assistant" && m.parts?.some(isToolCallPart),
          )
          const completedRounds = toolCallRounds.length

          if (completedRounds >= steps - 2) {
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
