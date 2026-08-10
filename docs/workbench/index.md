---
summary: "Operate the OpenClaw Workbench source distribution"
read_when:
  - You are evaluating or running the Workbench fork
  - You need to verify, update, recover, or remove a Workbench installation
title: "OpenClaw Workbench"
---

OpenClaw Workbench is a downstream source distribution with an operator-focused landing page.
It is intended to make OpenClaw setup state and operational destinations easier to understand.
It does not replace the Gateway, agent runtime, channels, Tasks, Workboard, Automations, Memory,
or companion apps.

## Current scope

| Workbench-owned surface | What it does                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Setup wizard            | Guides Gateway, model, channel, safety, and final review; includes model verification and a channel runtime probe         |
| Safety view             | Chooses a profile and approval expiry, checks the active Guardrails runtime, and displays or clears recent journal events |
| Mission creator         | Creates a labeled Workboard card with title, notes, priority, and optional agent assignment                               |
| Navigation defaults     | Places Workbench, Workboard, and Tasks near the start of the operating flow                                               |
| Source setup scripts    | Build the checkout, run OpenClaw onboarding, enable Workboard and Guardrails, restart the Gateway, and open the dashboard |
| Workbench Guardrails    | Applies an optional allow, ask, or block policy to classified tool activity                                               |

The project does not currently publish a signed Workbench bundle or a native graphical installer.
On Windows, the repository includes a launcher that can be double-clicked after the source is
downloaded. Other supported platforms run a local Bash script from an inspected checkout.

## Install from inspected source

Use GitHub's Code menu to download or clone the repository. Do not pipe a changing copy of a
network script directly into a shell.

From the repository root, choose the platform command:

```powershell
# Windows
.\workbench\install.ps1
```

```bash
# macOS, Linux, or WSL
bash ./workbench/install.sh
```

On Windows, mutating setup modes may request the official Git and Node.js LTS packages through
`winget`; Doctor and DryRun never bootstrap them. On macOS, Linux, and WSL, install those
prerequisites through the operating system's trusted package source first. Neither Workbench script
downloads and evaluates a remote shell script. Setup still pauses for the provider and channel
decisions that belong to the operator.

Supported Node.js ranges are 22.22.3 or newer within Node 22, 24.15 or newer within Node 24, and
25.9 or newer, including later major lines. The source build also needs Git, network access, and
enough disk space for the workspace dependencies and build output. If Corepack is absent, Install,
Update, and Repair provision exactly `corepack@0.34.7` through npm with lifecycle scripts disabled
and verify the version. Doctor never provisions it; DryRun only prints the command.

## Use the setup wizard

Open **Workbench** in the Control UI after onboarding. The five-step wizard provides:

1. The current browser-to-Gateway connection state and a link to connection settings.
2. A model setup link and a verification action that makes a real request and reports the model,
   latency, or error.
3. Configured, running, and connected channel counts refreshed from the Gateway channel snapshot.
4. A Guardrails profile and approval-expiry chooser that requires administrator access to apply.
5. A final review of the current readiness evidence.

The model check exercises provider auth, but the channel probe does not deliver a message. The
Guardrails check verifies that the Gateway registered the policy runtime; it does not inspect every
future tool call. Treat the review as a bounded setup report, not proof that every OpenClaw surface
is healthy.

## Verify real behavior

From the installed source directory:

```bash
corepack pnpm openclaw gateway status --deep
corepack pnpm openclaw doctor --lint
corepack pnpm openclaw plugins list --enabled --verbose
```

Workbench provides the bounded model, channel snapshot, and Guardrails checks described above; it
does not replace these CLI diagnostics. Then perform three operator-visible checks:

1. Send a harmless request to the configured model and confirm a response.
2. Send and receive a message through the channel you intend to use.
3. Trigger one low-risk action that exercises the chosen Guardrails profile and approval path.

The CLI checks and live checks answer different questions. Keep both in a setup acceptance test.

## Start useful work

The mission view creates a `todo` card through Workboard. It accepts a title, notes, priority, and
optional agent assignment, labels the card `workbench`, and returns the created card identifier.
Creating a card records work; it does not silently start an agent run. Open Workboard to review and
continue it.

Other operating shortcuts remain available:

- **Workboard** is the starting point for organizing multi-step work across agents.
- **Tasks** provides a return path to durable work.
- **Automations** turns a proven manual routine into scheduled or event-driven work.
- **Memory** and **Dashboards** help inspect retained context and current activity.
- **Apps** opens device-facing capabilities whose permissions should be reviewed separately.

Workbench links to these existing OpenClaw surfaces. It does not create a second orchestration or
storage layer around them.

## Update

Create a verified state backup and record the current source commit before changing the checkout:

```bash
corepack pnpm openclaw backup create --verify
git status --short
git rev-parse HEAD
```

Run the reviewed setup script in update mode to fast-forward the current branch of a clean Git
checkout whose origin is hosted on GitHub and whose repository name is `openclaw-workbench`. The
installer checks that URL shape; it does not authenticate maintainer identity or provenance:

```powershell
.\workbench\install.ps1 -Mode Update -SkipOnboarding
```

```bash
bash ./workbench/install.sh --mode update --skip-onboarding
```

Update mode refuses local changes, detached checkouts without an explicit revision, and unexpected
origins. It does not fetch upstream OpenClaw directly; upstream changes reach Workbench only after
the fork imports them.

Each real update fetches into `FETCH_HEAD`, shows the old and fetched commit IDs and a diff stat,
then defaults to no at a confirmation prompt before checkout, merge, dependency installation, or
build. For automation, use `-ExpectedCommit` or `--expected-commit` with the full fetched commit ID
instead of the prompt. A mismatch stops the run. Declining approval leaves `HEAD`, the working tree,
dependencies, and build output unchanged, although Git's `FETCH_HEAD` records the inspected fetch.

## Roll back

Code and persistent state have separate lifecycles. Switching source revisions does not undo a
state migration.

Inspect recent revisions with `git log --oneline -n 20`. To test a known revision, switch to its
exact commit, run the frozen dependency install and builds, then restart the Gateway. Restore state
only from a verified backup and only after reading the backup compatibility guidance.

Return to the maintained source line with `git switch main` before the next normal update.

## Uninstall

Preview every removal scope before approving it:

```bash
corepack pnpm openclaw backup create --verify
corepack pnpm openclaw uninstall --dry-run --all
corepack pnpm openclaw uninstall
```

The built-in uninstaller manages the selected service, state, workspace, and app scopes. It does
not need to remove the Workbench source checkout. Delete that checkout separately with the system
file manager after confirming that it does not contain state or workspace data you want to keep.

See [Uninstall](/install/uninstall) for platform recovery paths.

## Troubleshoot

| Observation                                   | Next action                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The updater refuses the checkout              | Run `git status --short` and preserve or commit the local work before updating             |
| The Gateway step stays incomplete             | Run `corepack pnpm openclaw gateway status --deep` and follow the connection settings link |
| Model verification fails                      | Read its returned provider error, then review model setup and credentials                  |
| Channel counts look healthy but messages fail | Run a real channel round trip and inspect channel-specific Gateway diagnostics             |
| Guardrails behaves differently than expected  | Check the selected profile and first matching custom rule, then refresh runtime status     |
| A recent upstream fix is missing              | Confirm whether its commit has been imported into the Workbench fork                       |

Use [Troubleshooting](/help/troubleshooting), [Doctor](/cli/doctor), and
[Manage plugins](/plugins/manage-plugins) for the underlying OpenClaw operations.

## Support and security scope

Workbench setup improves navigation but does not change OpenClaw's single-operator trust model.
Treat plugins as host-trusted code, keep the Gateway private unless its ingress is deliberately
secured, and use sandboxing when host isolation is required.

Workbench-owned defects and inherited OpenClaw defects have different maintainers. Report a
problem to the project that owns the affected surface.

### Workbench-owned reports

Use this repository's Issues tab for non-sensitive defects in:

- The Workbench page, route, setup indicators, or navigation defaults.
- `OpenClaw-Workbench-Setup.cmd` and the scripts under `workbench/`.
- The `workbench-guardrails` plugin.
- Workbench-specific documentation and compatibility behavior.

Include the operating system, Workbench commit SHA, imported OpenClaw version, exact command or UI
path, expected result, actual result, and sanitized logs. Do not include provider keys, channel
tokens, Gateway credentials, personal messages, or unredacted state databases.

### Upstream-owned reports

Use the upstream OpenClaw project when the same defect reproduces on an unmodified upstream build
and belongs to the CLI, Gateway, provider, channel, agent runtime, Task system, Workboard, Memory,
or companion app.

Before routing upstream, record the Workbench commit and reproduce against the corresponding
OpenClaw revision when practical. A Workbench-only navigation or policy difference is not an
upstream bug merely because the fork contains upstream source. Use [Troubleshooting](/help/troubleshooting)
for setup questions and the root repository `SECURITY.md` for the upstream disclosure policy.

### Sensitive Workbench-only findings

Do not post exploit details, credentials, private data, or an unpatched Workbench-only
vulnerability in a public issue or pull request.

Follow the root [security policy](../../SECURITY.md#workbench-fork-reporting) for the enabled GitHub
private-advisory form. If GitHub does not offer that form to your account, keep the technical
details private and open only a non-sensitive issue asking the maintainers to provide a
confidential intake path.

That issue may identify the affected Workbench-owned component and say that private coordination
is needed. It must not include the exploit, vulnerable inputs, secrets, screenshots of private
data, or enough detail to reconstruct the issue.

For a vulnerability that also affects upstream OpenClaw, use the private route published by the
upstream project instead of waiting for a Workbench-only route. Follow the upstream policy before
sharing any proof.

| Observation                                                           | Likely owner                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| Workbench percentage or card links are wrong                          | Workbench                                              |
| Local Workbench setup script clones, builds, or updates incorrectly   | Workbench                                              |
| Guardrails classifies or records a tool action incorrectly            | Workbench                                              |
| The same Gateway auth bypass exists in upstream OpenClaw              | Upstream OpenClaw                                      |
| A channel fails identically on the matching upstream revision         | Upstream OpenClaw or the owning channel plugin         |
| Behavior changes only after Workbench navigation or policy is enabled | Workbench first                                        |
| Ownership cannot be determined without sensitive evidence             | Keep evidence private and request a confidential route |

Remember that plugins run as trusted code on the Gateway host, Guardrails is not a sandbox or
authentication system, and the Workbench checks do not prove channel delivery or every plugin's
health. A source installer that can build and register a host service deserves the same review as
any other code with local execution access.

## Related

Continue with the [Workbench Guardrails plugin guide](../plugins/workbench-guardrails.md), the
[current OpenClaw Workbench delivery roadmap](roadmap.md), the
[OpenClaw Workboard operating guide](../plugins/workboard.md), the
[durable background Tasks guide](../automation/tasks.md), the
[browser Control UI guide](../web/control-ui.md), or the
[OpenClaw state backup and verification guide](../cli/backup.md).
