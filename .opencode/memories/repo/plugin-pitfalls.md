# Execsa Plugin — Pitfalls & Lessons

## execsa-prompts.json Dual-Copy Bug

**Symptom**: System prompt showed correct "task tool" text but reminder still said "use execsa instead of bash".

**Root cause**: The plugin repo has `prompts/execsa-prompts.json` with both `text` (reminder) and `system_text` (system instructions). But the **runtime copy** at `$OPENCODE_CONFIG_DIR/prompts/execsa-prompts.json` only had `text` — no `system_text` field. The `readPromptStore()` function returns `{ reminder: entry.text, system: entry.system_text || "" }`. When `system_text` is undefined, `system` is empty string, and the plugin falls back to its hardcoded `execsaSystemInstructions` constant (which had the correct text). The reminder used `text` directly from the stale file — showing old instructions.

**Fix**: Both copies must be kept in sync. Always update the runtime copy at `$OPENCODE_CONFIG_DIR/prompts/execsa-prompts.json` after changing the plugin repo's version.

## Enabled/Disabled Race Condition

**Symptom**: Setting `enabled: false` in `execsa-config.json` didn't actually disable execsa.

**Root cause**: The `enabled` and `reminder` flags were read once in the plugin factory IIFE (`export default async () => { const cfg = readExecsaConfig(); const enabled = ... }`), not inside each hook. Bun's module cache means the IIFE runs only once per process. Changing the config file and restarting had no effect — the captured `enabled` value was already `true`.

**Fix**: Every hook now reads config live from disk: `readExecsaConfig().enabled !== "false"` inside `config()`, `system.transform()`, and `messages.transform()`.

## Permission Mutation — Never Set `"*":"deny"` on Target Agents

**Severity**: CRITICAL. This bug resurfaced multiple times (May 2026).

**Symptom**: Non-execsa agents (coder, expert, explore) stopped dispatching their subagents.

**Root cause**: Code like `perm.task = { "*": currentTask ?? "deny", execsa: "allow" }` — when `currentTask` is `undefined` (agent has no explicit task permission), this sets `"*":"deny"` on every agent, effectively blocking all subagent dispatch except execsa.

**Correct pattern**:
```typescript
if (currentTask === undefined) {
  perm.task = { "*": "allow", execsa: "allow" }
} else if (typeof currentTask === "object") {
  perm.task = { ...currentTask, execsa: "allow" }
} else {
  perm.task = { "*": currentTask, execsa: "allow" }
}
```

**Tests**: `execsa/index.test.ts` covers all edge cases (9 tests, 14 assertions). Run with `bun test` from plugin root.

## Config File Live Reading (All Hooks)

The plugin's `config()`, `system.transform()`, and `messages.transform()` hooks all read from `execsa-config.json` on every invocation, not from cached module-level variables. This ensures changes take effect immediately on restart without stale state.

## Disabled Plugin MUST Teardown, Not Only Return Early

When `enabled: false`:
- `config()` must call `teardownExecsa()` — delete all `execsa*` agents from `cfg.agent` (swap-state still injects them) and remove `task.execsa` from target agents
- `system.transform()` must skip injection — no `<execsaSystemInstructions>` added
- `messages.transform()` must skip injection — no `<execsaReminder>` added
- `chat.params` temperature pinning is harmless (no execsa agent exists to use it)

**Why codergpt55xhigh called execsa with TUI off:** `execsa-config.json` had `enabled: false`, but `swap-state.json` still supplies `preserved_agents.execsa`. Old plugin only skipped registration; Task tool list still included execsa. System/reminder injection also failed when `EXECSA_CONFIG_PATH` was frozen at first import (wrong config dir after test order / stale path).

**Config paths:** `execsa-config.json` and prompts must be resolved on every read via `execsaConfigPath()` / `execsaConfigDir()`, not module-level IIFEs.

**Fork `plugin-sync`:** `patches/plugin-sync.ts` duplicates teardown in `agent.ts` but requires binary rebuild (`FORK:plugin-sync-agent-hide`). Standalone plugin teardown is the runtime fix without rebuild.

Tested in `execsa/index.disabled.test.ts`. Use distinct `import(\`./index.ts?...\`)` query per test file so Bun does not share one cached module with wrong `OPENCODE_CONFIG_DIR`.
