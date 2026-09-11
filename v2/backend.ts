import { Plugin } from "@opencode-ai/plugin"
import {
  EXECSA_AGENT,
  EXECSA_SYSTEM_MARKER,
  configureAgents,
  execsaAgentSystem,
  execsaSystemInstructions,
  reminderText,
} from "./backend-core"
import { readConfig, readPromptStore, withOptions } from "./config"

export default Plugin.define({
  id: "opencode-execsa-v2",
  setup: async (context) => {
    const registrations: Array<{ dispose(): Promise<void> }> = []
    const initial = withOptions(readConfig(), context.options)

    registrations.push(await context.agent.transform((draft) => configureAgents(draft as any, initial)))
    registrations.push(await context.session.hook("context", (event) => {
      const config = withOptions(readConfig(), context.options)
      if (config.enabled === "false") return
      const prompts = readPromptStore(config)

      if (event.agent !== EXECSA_AGENT) {
        if (!event.system.some((part) => part.text.includes(EXECSA_SYSTEM_MARKER))) {
          event.system.unshift({ type: "text", text: prompts?.system || execsaSystemInstructions })
        }
        if (config.always_extend === "true" && !event.system.some((part) => part.text.includes("Extended Capacity"))) {
          event.system.push({
            type: "text",
            text: "[Extended Capacity] The execsa subagent has up to 200 steps available.",
          })
        }

        if (config.reminder !== "false") {
          const message = [...event.messages].reverse().find((item) => item.role === "user")
          if (message && !message.content.some((part) => part.type === "text" && part.text.includes("execsaReminder"))) {
            message.content.push({ type: "text", text: reminderText(prompts?.reminder) })
          }
        }
        return
      }

      if (!event.system.some((part) => part.text.includes("execution-focused subagent"))) {
        event.system.unshift({ type: "text", text: execsaAgentSystem })
      }
      if (config.nudge_enabled !== "true") return
      const steps = config.always_extend === "true" ? 200 : Number.parseInt(config.steps || "15", 10)
      const rounds = event.messages.filter(
        (message) => message.role === "assistant" && message.content.some((part) => part.type === "tool-call"),
      ).length
      const alreadyNudged = event.messages.some((message) =>
        message.content.some((part) => part.type === "text" && part.text.includes("allotted iterations are finished")),
      )
      if (rounds >= steps - 2 && !alreadyNudged) {
        event.messages.push({
          role: "user",
          content: [{ type: "text", text: "OK, your allotted iterations are finished. Show the final answer." }],
        } as any)
      }
    }))

    return async () => {
      for (const registration of registrations.reverse()) await registration.dispose()
    }
  },
})
