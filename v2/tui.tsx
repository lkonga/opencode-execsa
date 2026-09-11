import { Plugin } from "@opencode/plugin/tui"
import { readConfig, writeConfigValue } from "./config"

async function settings(context: Plugin.Context) {
  const config = readConfig()
  const action = await context.ui.dialog.select({
    title: "Execsa settings",
    options: [
      { title: `Enabled: ${config.enabled !== "false" ? "yes" : "no"}`, value: "enabled" },
      { title: `Reminder: ${config.reminder !== "false" ? "yes" : "no"}`, value: "reminder" },
      { title: `Extended steps: ${config.always_extend === "true" ? "yes" : "no"}`, value: "always_extend" },
      { title: `External directories: ${config.allow_external_dir !== "false" ? "yes" : "no"}`, value: "allow_external_dir" },
      { title: `Model: ${config.model}`, value: "model" },
      { title: `Steps: ${config.steps}`, value: "steps" },
      { title: `Target agents: ${config.execsa_target_agents}`, value: "execsa_target_agents" },
      { title: "Help", value: "help" },
    ],
  })
  if (!action) return

  if (["enabled", "reminder", "always_extend", "allow_external_dir"].includes(action)) {
    writeConfigValue(action, config[action] === "true" ? "false" : "true")
  } else if (action === "help") {
    await context.ui.dialog.alert({
      title: "Execsa",
      message: "Execsa delegates terminal execution to a focused subagent. Backend changes apply after the V2 service reloads the plugin.",
    })
    return
  } else {
    const value = await context.ui.dialog.prompt({ title: `Execsa ${action}`, value: config[action] || "" })
    if (value === undefined) return
    if (action === "steps" && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) {
      context.ui.toast.show({ variant: "error", message: "Steps must be a positive integer" })
      return
    }
    writeConfigValue(action, value.trim())
  }
  context.ui.toast.show({ variant: "success", message: "Execsa setting saved" })
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    commands: [{
      id: "execsa.settings",
      title: "Execsa settings",
      description: "Configure the execsa execution subagent",
      group: "Agents",
      palette: true,
      slash: { name: "execsa" },
      run: () => settings(props.context),
    }],
  }))
  return null
}

export default Plugin.define({
  id: "opencode-execsa-v2-tui",
  setup: (context) => context.ui.slot({ append: "app", render: () => <Commands context={context} /> }),
})
