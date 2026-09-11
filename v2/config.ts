import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type ExecsaConfig = Record<string, string>

export const DEFAULT_CONFIG: ExecsaConfig = {
  enabled: "true",
  reminder: "true",
  always_extend: "false",
  allow_external_dir: "true",
  execsa_target_agents: "build",
  model: "neuralwatt/neuralwatt-glm-5.1-fast",
  steps: "15",
  prompt_style: "Default (soft)",
  nudge_enabled: "false",
}

export function configDirectory() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode")
}

export function configPath() {
  return path.join(configDirectory(), "execsa-config.json")
}

export function readConfig(): ExecsaConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function withOptions(config: ExecsaConfig, options: Readonly<Record<string, unknown>>): ExecsaConfig {
  const strings = Object.fromEntries(Object.entries(options).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  return { ...config, ...strings }
}

export function writeConfigValue(key: string, value: string) {
  const file = configPath()
  const next = { ...readConfig(), [key]: value }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  fs.renameSync(temporary, file)
}

export function readPromptStore(config: ExecsaConfig = readConfig()): { reminder: string; system: string } | undefined {
  try {
    const file = path.join(configDirectory(), "prompts", "execsa-prompts.json")
    const prompts = JSON.parse(fs.readFileSync(file, "utf8"))
    const selected = prompts.find((item: any) => item.name === config.prompt_style)
    if (selected) return { reminder: selected.text || "", system: selected.system_text || "" }
  } catch {}
}
