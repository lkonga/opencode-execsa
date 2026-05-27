# Changelog

## v1.2.0 (2026-05-26)

- **feat:** auto-enable/disable server side on TUI plugin toggle (Plugins dialog)
- **feat:** sync model to agents/execsa.md frontmatter on settings change
- **fix:** config file is source of truth, KV is fallback only (eliminated drift)
- **fix:** refresh settings UI immediately after toggle (dialog.clear + reopen)
- **fix:** properly disable when enabled=false — all hooks read config live
- **fix:** suppress messages.transform reminder when enabled=false
- **chore:** sync prompts with correct task tool text + pitfalls memory

## v1.1.1 (2026-05-24)

- **fix:** permission mutation preserves `*:allow` instead of `*:deny`
- **fix:** only ADD execsa:allow to target agents, never replace task permissions
- **test:** 9 permission edge cases, 14 assertions

## v1.1.0 (2026-05-22)

- **feat:** TUI settings dialog for model, steps, temperature, reminder
- **feat:** per-agent target configuration (execsa_target_agents)
- **feat:** prompt style selection (Strict / Default soft)
- **feat:** nudge on last turn when execsa should be preferred

## v1.0.0 (2026-05-18)

- Initial release: execsa subagent with backend plugin and TUI controls
