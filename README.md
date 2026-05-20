# opencode-execsa

OpenCode plugin: execsa subagent TUI controls, configuration, and system instruction injection.

## What it does

- Registers the `execsa` subagent for safe terminal command execution
- Injects `<execsaSystemInstructions>` and `<execsaReminder>` into the parent agent's prompt
- Pins `temperature: 0` for the execsa agent
- Provides `/execsa` TUI settings dialog for model, steps, temperature, and reminder toggles

## Requirements

- OpenCode v1.4+ with plugin support
- GitHub Copilot authentication or configured provider for the execsa agent

## Installation

### npm (recommended)

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-execsa"]
}
```

### Local file path

```json
{
  "plugin": ["file:///path/to/opencode-execsa/execsa/index.ts"]
}
```

### TUI plugin

For the `/execsa` settings command, add to your `tui.json`:

```json
{
  "plugin": ["/path/to/opencode-execsa/tui.ts"]
}
```

## Configuration

Create `execsa-config.json` in your OpenCode config directory:

```json
{
  "enabled": "true",
  "reminder": "true",
  "model": "provider/model-id",
  "steps": "15",
  "temperature": "0",
  "always_extend": "false",
  "allow_external_dir": "false",
  "nudge_enabled": "false",
  "provider_whitelist": "",
  "prompt_style": "Default (soft)"
}
```

All settings are configurable via the `/execsa` TUI command.
