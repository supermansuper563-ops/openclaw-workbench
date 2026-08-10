---
summary: "Workbench safety profiles, native approvals, and redacted execution journaling"
read_when:
  - You are enabling or configuring Workbench Guardrails
  - You want risky tool actions to require operator approval
title: "Workbench Guardrails plugin"
---

Workbench Guardrails is a bundled, opt-in safety plugin. It classifies tool calls as read, write, execute, send, publish, or delete actions, applies the selected profile and operator rules, then uses OpenClaw's native approval flow for actions that require confirmation.

## Enable it

The Workbench installer enables the plugin automatically. Existing source installations can enable it manually:

```bash
openclaw plugins enable workbench-guardrails
openclaw gateway restart
```

The plugin is not enabled by the upstream-compatible default. Explicit enablement is required because it can block or pause tool calls.

## Profiles

| Profile         | Behavior                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| `personal-safe` | Allows reads, asks before writes, execution, sending, publishing, or deletion.    |
| `coding`        | Allows reads and writes, asks before execution, sending, publishing, or deletion. |
| `research-only` | Allows reads and blocks every side effect.                                        |
| `high-autonomy` | Allows ordinary work but still asks before publishing or deletion.                |

Set the profile under `plugins.entries.workbench-guardrails.config.profile`. The first matching custom rule overrides the profile.

```json5
{
  plugins: {
    entries: {
      "workbench-guardrails": {
        enabled: true,
        config: {
          profile: "coding",
          approvalTtlMinutes: 60,
          rules: [
            {
              outcome: "block",
              effects: ["publish"],
              reason: "Production publishing is disabled on this Gateway.",
            },
          ],
        },
      },
    },
  },
}
```

Rules can match tool names, effects, and a derived path prefix. Keep broad allow rules above narrower fallback rules only when that order is intentional.

## Journal

Decisions, approval resolutions, and terminal tool outcomes are stored in the plugin-scoped SQLite state store. Keys that look like tokens, passwords, API keys, cookies, credentials, authorization values, or secrets are redacted before persistence. The journal stores bounded metadata, not raw tool output.

## Limitations

Classification uses the registered tool name, HTTP method hints, and host-derived paths. It complements OpenClaw's sandbox, exec policy, pairing, scopes, and approval systems; it is not a substitute for them. Review [Security](/gateway/security) before exposing a Gateway to other users or networks.

## Related

- [OpenClaw Workbench](/workbench/index)
- [Approvals](/tools/exec-approvals)
- [Manage plugins](/plugins/manage-plugins)
- [Sandboxing](/gateway/sandboxing)
