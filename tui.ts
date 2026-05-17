import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
import { spawnSync } from "node:child_process"

type SettingKey = "enabled" | "model" | "provider_whitelist" | "reminder" | "prompt_style" | "temperature" | "steps" | "nudge_enabled" | "always_extend" | "allow_external_dir"

const DEFAULTS: Record<SettingKey, string> = {
  enabled: "true",
  model: "neuralwatt/neuralwatt-glm-5.1-fast",
  prompt_style: "Strict",
  temperature: "0",
  steps: "15",
  provider_whitelist: "",
  reminder: "true",
  nudge_enabled: "false",
  always_extend: "false",
  allow_external_dir: "true",
}

const SETTINGS: Array<{ key: SettingKey; label: string; type: "toggle" | "model" | "select" | "text"; options?: string[] }> = [
  { key: "enabled", label: "Execsa enabled", type: "toggle" },
  { key: "model", label: "Model", type: "model" },
  { key: "reminder", label: "Extra Reminder", type: "toggle" },
  { key: "prompt_style", label: "Prompt style", type: "select", options: ["Strict", "Default (soft)"] },
  { key: "temperature", label: "Temperature", type: "text" },
  { key: "steps", label: "Max steps", type: "text" },
  { key: "nudge_enabled", label: "Last-turn nudge", type: "toggle" },
  { key: "always_extend", label: "Always extend steps", type: "toggle" },
  { key: "allow_external_dir", label: "Allow external dirs", type: "toggle" },
]

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Execsa Settings",
      value: "execsa.show",
      category: "Fork",
      slash: { name: "execsa", aliases: ["ex"] },
      onSelect: () => showSettings(api),
    },
  ])
}

const EXECSA_CONFIG_PATH = require("path").join(
  process.env.OPENCODE_CONFIG_DIR || require("path").join(require("os").homedir(), ".config", "opencode"),
  "execsa-config.json",
)

const EXECSA_PROMPT_PATH = require("path").join(
  process.env.OPENCODE_CONFIG_DIR || require("path").join(require("os").homedir(), ".config", "opencode"),
  "prompts",
  "execsa-prompts.json",
)

export function parseEditorCommand(editor: string): string[] {
  return (editor.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [])
    .map((part) => part.replace(/^(["'])(.*)\1$/, "$2"))
}

function editPromptFile(api: TuiPluginApi): void {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    api.ui.toast({ variant: "error", message: "Set VISUAL or EDITOR to edit Execsa prompts" })
    api.command.trigger("execsa.show")
    return
  }

  const parts = parseEditorCommand(editor)
  if (parts.length === 0) {
    api.ui.toast({ variant: "error", message: "Invalid editor command" })
    api.command.trigger("execsa.show")
    return
  }

  try {
    const fs = require("fs")
    const path = require("path")
    fs.mkdirSync(path.dirname(EXECSA_PROMPT_PATH), { recursive: true })

    const [cmd, ...args] = parts
    const result = spawnSync(cmd, [...args, EXECSA_PROMPT_PATH], {
      stdio: "inherit",
      shell: process.platform === "win32",
    })

    if (result.error) {
      api.ui.toast({ variant: "error", message: `Editor failed: ${result.error.message}` })
    } else if (result.status !== 0) {
      const reason = result.signal ? `signal ${result.signal}` : `exit ${result.status}`
      api.ui.toast({ variant: "error", message: `Editor failed: ${reason}` })
    } else {
      api.ui.toast({ variant: "success", message: "Execsa prompts updated" })
    }
  } catch (err: any) {
    api.ui.toast({ variant: "error", message: `Editor failed: ${err?.message ?? String(err)}` })
  }

  api.command.trigger("execsa.show")
}

function writeConfig(api: TuiPluginApi, key: string, val: string): void {
  api.kv.set(key, val)
  // Also persist to shared config file for the server plugin to read
  try {
    const fs = require("fs")
    const existing = fs.existsSync(EXECSA_CONFIG_PATH) ? JSON.parse(fs.readFileSync(EXECSA_CONFIG_PATH, "utf-8")) : {}
    existing[key] = val
    fs.writeFileSync(EXECSA_CONFIG_PATH, JSON.stringify(existing, null, 2), "utf-8")
  } catch {}
}

function get(api: TuiPluginApi, key: SettingKey): string {
  return (api.kv.get(key) as string) ?? DEFAULTS[key]
}

function set(api: TuiPluginApi, key: SettingKey, val: string): void {
  writeConfig(api, key, val)
}

export function buildModelOptions(
  providers: ReadonlyArray<{ id: string; name: string; models: Record<string, { id: string; name: string; status: string }> }>,
  current: string,
  whitelistStr: string,
): TuiDialogSelectOption<string>[] {
  const whitelist = whitelistStr ? whitelistStr.split(",").map((s) => s.trim()).filter(Boolean) : []
  const opts: TuiDialogSelectOption<string>[] = []

  for (const provider of providers) {
    if (whitelist.length > 0 && !whitelist.includes(provider.id)) continue

    for (const modelId of Object.keys(provider.models)) {
      const model = provider.models[modelId]
      if (model.status === "deprecated") continue

      const fullId = `${provider.id}/${modelId}`
      opts.push({
        title: model.name || modelId,
        value: fullId,
        description: fullId === current ? "currently selected" : undefined,
        category: provider.name || provider.id,
      })
    }
  }

  opts.sort((a, b) => {
    if (a.value === current) return -1
    if (b.value === current) return 1
    return a.title.localeCompare(b.title)
  })

  return opts
}

function showHelp(api: TuiPluginApi): void {
  const dialog = api.ui.dialog
  dialog.setSize("large")
  dialog.replace(() =>
    api.ui.DialogAlert({
      title: "Execsa — Usage & Settings",
      message: [
        "Execsa delegates terminal commands to a dedicated execution subagent.",
        "It runs commands and returns filtered results in the chat.",
        "",
        "─── Slash Commands ───",
        "  /execsa     Open Execsa settings and management",
        "  /ex         Alias for /execsa",
        "  esc         Close current dialog",
        "",
        "─── Settings ───",
        "  Enabled      Toggle ON/OFF. When OFF, commands fall through.",
        "  Model        LLM model for the execution subagent.",
        "  Prompt style  How commands are interpreted (see below).",
        "  Temperature  LLM sampling temperature (0 = deterministic).",
        "  Max steps    Max execution steps before timeout.",
        "  Model providers  Comma-separated provider IDs to show (empty = all).",
        "",
        "─── Prompt Styles ───",
        '  "Strict"           Precise command formatting with safety checks.',
        "                     Prevents ambiguous or unsafe operations.",
        '  "Default (soft)"   Flexible interpretation. Agent may make',
        "                     judgment calls on command formatting.",
        "",
        "─── Tips ───",
        "  • Toggle execsa on/off quickly from the settings menu.",
        "  • Config is shared between TUI and server via execsa-config.json.",
        "  • Temperature 0 = fully deterministic; higher values add variety.",
        "  • Model selection is dynamic from configured providers (excludes deprecated).",
      ].join("\n"),
      onConfirm: () => api.command.trigger("execsa.show"),
    }),
  )
}

function showSettings(api: TuiPluginApi): void {
  const helpOption: TuiDialogSelectOption<string> = { title: "Help", value: "help", category: "Navigation" }
  const options: TuiDialogSelectOption<string>[] = [
    ...SETTINGS.map((s) => {
      const val = get(api, s.key)
      const display = s.type === "toggle" ? (val === "true" ? "ON" : "OFF") : val
      return { title: `${s.label}: ${display}`, value: s.key, description: s.type === "toggle" ? "Toggle ON/OFF" : "Tap to edit" }
    }),
    { title: "Edit prompt file", value: "edit_prompt", category: "Navigation" },
    helpOption,
  ]

  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect({
      title: "Execsa settings",
      options,
      onSelect: (opt) => handleSelect(api, opt!.value),
    }),
  )
}

function handleSelect(api: TuiPluginApi, value: string): void {
  if (value === "help") { showHelp(api); return }
  if (value === "edit_prompt") { editPromptFile(api); return }

  const s = SETTINGS.find((x) => x.key === value)
  if (!s) return

  if (s.type === "toggle") {
    const next = get(api, s.key as SettingKey) === "true" ? "false" : "true"
    set(api, s.key as SettingKey, next)
    api.ui.toast({ variant: "success", message: `Execsa ${next === "true" ? "enabled" : "disabled"}` })
    api.command.trigger("execsa.show")
    return
  }

  if (s.type === "model") {
    const current = get(api, "model")
    const whitelistStr = get(api, "provider_whitelist")
    const opts = buildModelOptions(api.state.provider, current, whitelistStr)
    opts.push({ title: "← Back", value: "cancel", category: "Navigation" })

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: "Execsa Model",
        placeholder: "Search models...",
        options: opts,
        current,
        onSelect: (opt) => {
          if (opt!.value === "cancel") { api.command.trigger("execsa.show"); return }
          set(api, "model", opt!.value)
          api.ui.toast({ variant: "success", message: `Model: ${opt!.value}` })
          api.command.trigger("execsa.show")
        },
      }),
    )
    return
  }

  if (s.type === "select") {
    const current = get(api, s.key as SettingKey)
    const opts = (s.options ?? []).map((o) => ({
      title: o,
      value: o,
      description: o === current ? "currently selected" : undefined,
    }))
    opts.push({ title: "← Back", value: "cancel", category: "Navigation" })

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: s.label,
        options: opts,
        current,
        onSelect: (opt) => {
          if (opt!.value === "cancel") { api.command.trigger("execsa.show"); return }
          set(api, s.key as SettingKey, opt!.value)
          api.ui.toast({ variant: "info", message: `${s.label}: ${opt!.value}` })
          api.command.trigger("execsa.show")
        },
      }),
    )
    return
  }

  if (s.type === "text") {
    const current = get(api, s.key as SettingKey)
    api.ui.dialog.replace(() =>
      api.ui.DialogPrompt({
        title: s.label,
        value: current,
        placeholder: current,
        onConfirm: (v) => {
          set(api, s.key as SettingKey, v.trim())
          api.ui.toast({ variant: "success", message: `${s.label} updated` })
          api.command.trigger("execsa.show")
        },
        onCancel: () => api.command.trigger("execsa.show"),
      }),
    )
    return
  }
}

export default { id: "execsa-tui", tui } as TuiPluginModule & { id: string }
