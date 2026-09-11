# Execsa for OpenCode V2

Load the backend from V2 core config (`opencode.json`):

```json
{
  "plugins": [
    { "package": "file:///absolute/path/to/opencode-execsa/v2/backend.ts", "options": {} }
  ]
}
```

Load the TUI surface from V2 `cli.json` (V2 has no `tui.json`):

```json
{
  "plugins": ["file:///absolute/path/to/opencode-execsa/v2/tui.tsx"]
}
```

The backend uses the public promise-plugin `agent.transform` and `session.hook("context")` APIs. The TUI registers `/execsa` and `execsa.settings` through a public keymap layer mounted in the `app` slot.

Execsa is non-hidden in V2 because the subagent tool omits hidden agents from its advertised catalog.

V2 permission rules are append-only here: selected parent agents retain every existing rule, followed by the exact `{ action: "subagent", resource: "execsa", effect: "allow" }` rule. No wildcard deny is introduced on parent agents.
