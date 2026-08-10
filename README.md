# OpenClaw Workbench

**A focused operating console and guided source setup for OpenClaw.**

OpenClaw Workbench is a standalone project for people who want a clearer path from downloading
OpenClaw to running useful work. It builds on the OpenClaw runtime and adds a Workbench landing
page, an inline setup wizard, live verification actions, mission creation, and an optional
Guardrails plugin. **Local open-weight models are supported.**

This is currently a **source distribution**, not a signed desktop installer. The Windows
launcher is the closest path to one-click setup after downloading and inspecting the source.
macOS, Linux, and WSL use one local script from the checkout. Provider and channel credentials
still go through OpenClaw's interactive onboarding.

[Start from a checkout](#start-from-a-checkout) · [Workbench guide](docs/workbench/index.md) ·
[Current roadmap](docs/workbench/roadmap.md) ·
[Support and security scope](docs/workbench/index.md#support-and-security-scope) ·
[Upstream OpenClaw](https://github.com/openclaw/openclaw)

## Standalone repository history

OpenClaw Workbench used to be a fork of
[openclaw/openclaw](https://github.com/openclaw/openclaw). It is now maintained as a standalone
public GitHub repository so Workbench can have its own releases, roadmap, search presence, and
contributor history. The former fork and its pull-request history remain available in the
[fork archive](https://github.com/supermansuper563-ops/openclaw-workbench-fork-archive).

OpenClaw's original authors and license remain credited below and in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Standalone status does not imply endorsement by
the upstream OpenClaw project.

## Why Workbench is useful

OpenClaw has a broad runtime. The hard part for a new operator is often finding the next useful
action among models, channels, agents, tasks, memory, automations, and plugins. Workbench gives
those surfaces an operational front door.

| Need                         | What Workbench provides today                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Finish initial setup         | A five-step wizard for Gateway, model, channel, safety profile, and final review                                |
| Run models on your hardware  | A guided path to OpenClaw's Ollama, LM Studio, and vLLM support, followed by a real response check               |
| Verify the important pieces  | A real model-response check, refreshed channel runtime counts, and Guardrails runtime status                    |
| Start substantial work       | An inline form that creates a labeled Workboard card with title, notes, priority, and optional agent assignment |
| Return to ongoing work       | A shortcut to durable Tasks instead of relying on browser history                                               |
| Build a repeatable routine   | Direct access to Automations, Memory, Dashboards, and Apps                                                      |
| Tune an approval boundary    | A profile chooser, approval-expiry control, active runtime check, and recent redacted journal view              |
| Recover from a partial setup | Each incomplete step links to the OpenClaw surface that owns the setting                                        |

## Local open-weight model support

Yes—OpenClaw Workbench supports local open-weight models through OpenClaw's existing provider
system. The guided model step works with:

- **Ollama** for a simple local model server.
- **LM Studio** for locally loaded models exposed through its server.
- **vLLM** for self-hosted, OpenAI-compatible inference.

Start the local server and load a model, then open **Workbench → Setup → Model → Open model
setup**. Select the local provider and model, return to Workbench, and choose **Verify model** to
make a real request through the Gateway.

A cloud model or cloud API key is not required when a local provider is configured. Workbench
does not currently install a local runtime or download multi-gigabyte model files automatically;
those steps and their hardware requirements remain under the operator's control. See the
[model-provider guide](docs/concepts/model-providers.md#ollama) for provider-specific setup.

Workbench distinguishes configured state from checks the operator runs. Model verification makes
a real request and reports its result. The channel probe refreshes configured, running, and
connected counts, but it does not send a message. Guardrails health confirms that the Gateway
registered the policy runtime. None of these checks is an end-to-end health certificate, so use
the real delivery checks below before trusting a new installation.

## Delivery status

| Surface                                                      | Status                                                |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Five-step setup wizard                                       | Available in the Workbench page                       |
| Model verification and channel runtime probe                 | Available in the setup wizard                         |
| Guardrails profile, runtime, and journal views               | Available in the Workbench page                       |
| Workboard mission creator                                    | Available in the Workbench page                       |
| Guided OpenClaw onboarding                                   | Available through the setup scripts                   |
| Windows double-click launcher                                | Available after downloading the repository            |
| Local PowerShell and Bash setup                              | Available after downloading or cloning the repository |
| Signed release bundle                                        | Not available yet                                     |
| Native graphical installer                                   | Not available yet                                     |
| Backup, restore, and upstream-sync controls inside Workbench | Planned, not shipped                                  |

## Start from a checkout

### Before you begin

You need:

- A supported Windows, macOS, Linux, or WSL environment.
- Network access to GitHub, the package registry, and the model or channel services you choose.
- Git for cloning and future updates. The Windows script can offer to install Git when `winget`
  is available.
- PowerShell on Windows, or Bash on macOS, Linux, and WSL.
- Enough free disk space for the repository, pnpm store, dependencies, and build output.
- Time to complete interactive model-provider onboarding.

The setup flow accepts Node.js 22.22.3 or newer within Node 22, Node.js 24.15 or newer within
Node 24, and Node.js 25.9 or newer, including later major lines. On Windows, mutating setup modes
can request the official Node.js LTS package through `winget`; Doctor and DryRun never do. The Bash
script stops with an actionable Node.js prerequisite message. If Corepack is absent, mutating modes
provision exactly `corepack@0.34.7` through npm with lifecycle scripts disabled and verify the
installed version. Doctor never provisions it, and DryRun only prints that command. Neither path
downloads and evaluates a remote shell script.

### Get the source

Use GitHub's **Code** menu to clone this repository, or
[download the current `main` source as a ZIP](../../archive/refs/heads/main.zip). The ZIP follows
the moving `main` branch; it is not a signed or immutable release artifact. Record the commit SHA
if you need a reproducible install.

### Windows

After extracting the repository, double-click
[`OpenClaw-Workbench-Setup.cmd`](OpenClaw-Workbench-Setup.cmd).

To keep the setup visible and inspectable, you can run the underlying script from the repository
root instead:

```powershell
.\workbench\install.ps1
```

Review [`workbench/install.ps1`](workbench/install.ps1) before execution. The launcher invokes
that same file; it does not provide a separate security boundary.

### macOS, Linux, and WSL

From the repository root:

```bash
bash ./workbench/install.sh
```

Review [`workbench/install.sh`](workbench/install.sh) first. Running a local, inspected file makes
the execution path visible and avoids piping a changing network response directly into a shell.

### Existing source checkout

If dependencies are already installed and you want to perform the steps manually:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm openclaw onboard --install-daemon
corepack pnpm openclaw plugins enable workbench-guardrails
corepack pnpm openclaw plugins enable workboard
corepack pnpm openclaw gateway restart
corepack pnpm openclaw dashboard
```

This path is intentionally interactive. Workbench does not generate provider keys, channel
tokens, or consent on your behalf.

## Your first five minutes

1. Complete OpenClaw onboarding and choose a provider you control. Local open-weight models are
   supported through Ollama, LM Studio, and vLLM.
2. Open the dashboard when setup finishes, choose **Workbench**, then start the setup wizard.
3. Verify the model from the model step. A successful result names the model and reports its
   response latency.
4. Refresh channel status from the channel step, then send one real test message through the
   channel you intend to use. Runtime counts do not prove delivery.
5. Choose a Guardrails profile and approval expiry, apply it with administrator access, then review
   the final setup summary.
6. Create a small mission in Workbench and open the resulting card in Workboard.

Good first workflows include:

- **Plan and carry out a multi-step job:** create a mission in Workbench with a title, notes,
  priority, and agent, then open its Workboard card.
- **Resume work later:** use Tasks for work that should survive a page reload or a new browser
  session.
- **Turn a repeated job into a routine:** move from a successful manual run into Automations.
- **Inspect context before acting:** visit Memory and Dashboards to understand what the Gateway
  has retained and what it is doing.
- **Add device capabilities deliberately:** use Apps only after reviewing the permission and
  trust boundary of the target device.

## Verify the installation

Run these commands from the installed source directory:

```bash
corepack pnpm openclaw gateway status --deep
corepack pnpm openclaw doctor --lint
corepack pnpm openclaw plugins list --enabled --verbose
corepack pnpm openclaw dashboard
```

Then verify behavior rather than configuration alone:

- Confirm that `workbench-guardrails` and `workboard` appear in the enabled plugin list.
- Make a low-risk model request and confirm that a response returns.
- Send and receive a message through each channel you plan to depend on.
- Confirm that Workbench reports the Guardrails runtime as active and can load recent journal
  events.
- Exercise one Guardrails approval with a disposable file or similarly harmless action.
- Read any `doctor --lint` finding before enabling wider host access.

## What Guardrails can and cannot do

Workbench Guardrails classifies tool activity into read, write, execute, send, publish, delete,
and unknown effects. A selected profile and optional rules then return an allow, ask, or block
outcome. Actions classified as unknown, delete, or publish retain a mandatory approval boundary
even when a custom allow rule matches; research-only blocks unknown activity. Actions that require
confirmation use OpenClaw's approval mechanism, and bounded decision metadata is written to
plugin-owned SQLite state.

The Workbench safety view can change the profile and approval expiry, confirm whether the policy
runtime is registered, display recent redacted decision, approval, and outcome records, and clear
the journal with administrator access.

Guardrails is defense in depth. It does not:

- Replace OpenClaw sandboxing, pairing, Gateway authentication, or host permissions.
- Prove that every third-party plugin describes its behavior accurately.
- Turn one Gateway into a secure boundary between mutually untrusted operators.
- Make prompt injection harmless.
- Guarantee that arbitrary secret-shaped values are removed from every journal field.
- Verify that a configured model, channel, or app is healthy.

Start with the `personal-safe` or `research-only` profile when learning the system. Treat
`high-autonomy` as an explicit trust decision, not a performance setting. See the
[Guardrails guide](docs/plugins/workbench-guardrails.md) for profile behavior and limitations.

## Update safely

Update mode fast-forwards the current branch of an existing clean Git checkout after confirming
that its origin is a GitHub repository named `openclaw-workbench`. This checks the host and
repository name, not maintainer identity or source provenance. It does not import upstream OpenClaw
commits automatically, and it stops when the checkout has local changes or an unexpected origin.

Before an update:

```bash
corepack pnpm openclaw backup create --verify
git status --short
git rev-parse HEAD
```

Keep the reported commit SHA with the backup. Then run the same local PowerShell or Bash setup
script used for installation in update mode:

```powershell
.\workbench\install.ps1 -Mode Update -SkipOnboarding
```

```bash
bash ./workbench/install.sh --mode update --skip-onboarding
```

The installer fetches only into `FETCH_HEAD`, reports the current and fetched commits, and prints a
diff stat without external diff helpers. It then defaults to no at an approval prompt before it
changes `HEAD` or runs dependency and build commands. For non-interactive automation, pass the full
fetched commit with `-ExpectedCommit` or `--expected-commit`; a mismatch stops the run. Declining
approval leaves the checkout and build output unchanged, although Git's `FETCH_HEAD` records what
was inspected.

Upstream fixes become available here only after this repository imports and validates them. The
standalone repository does not make a local installation self-updating.

## Roll back

A code rollback and a state rollback are different operations. Older code may not understand
state migrated by newer code, so create and verify a backup before updating.

To inspect available commits without changing files:

```bash
git log --oneline -n 20
```

To test a known commit, stop active work, switch to that exact commit, reinstall pinned
dependencies, rebuild, and restart the Gateway:

```bash
git switch --detach <known-good-commit>
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm openclaw gateway restart
```

Return to the maintained branch with `git switch main`. If the update changed persistent state,
follow the OpenClaw backup and restore documentation rather than assuming a code checkout reverses
the migration.

## Uninstall without losing data by accident

Create a verified backup first. Preview the built-in uninstaller before approving any removal:

```bash
corepack pnpm openclaw backup create --verify
corepack pnpm openclaw uninstall --dry-run --all
corepack pnpm openclaw uninstall
```

The OpenClaw uninstaller manages the Gateway service, state, workspaces, and apps according to the
scopes you approve. The Workbench source checkout is separate; remove that directory with your
file manager only after confirming the state and workspace you want to keep. See the
[upstream uninstall guide](https://docs.openclaw.ai/install/uninstall) for platform-specific
recovery steps.

## Troubleshooting map

| Symptom                                       | First check                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Setup refuses to update                       | Inspect `git status --short` and `git remote get-url origin`; update mode requires a clean expected checkout              |
| Node version is rejected                      | Compare `node --version` with the supported ranges above, then rerun the reviewed setup script                            |
| Build or dependency install fails             | Preserve the first error, confirm network and disk availability, and retry `corepack pnpm install --frozen-lockfile` once |
| Dashboard does not connect                    | Run `corepack pnpm openclaw gateway status --deep` and `corepack pnpm openclaw doctor --lint`                             |
| Workbench shows incomplete setup              | Follow the specific card; do not treat the percentage as the diagnosis                                                    |
| Indicator is green but work fails             | Test the real provider, channel, or plugin path and inspect Gateway diagnostics                                           |
| Guardrails asks or blocks unexpectedly        | Inspect the selected profile and the first matching custom rule                                                           |
| Update does not include a recent upstream fix | Check whether that upstream commit has been imported into this repository                                                 |

More detail lives in the [Workbench operating guide](docs/workbench/index.md) and the
[OpenClaw troubleshooting guide](https://docs.openclaw.ai/help/troubleshooting).

## Compatibility and ownership

- Workbench follows the OpenClaw version recorded in [`package.json`](package.json); it does not
  define an independent compatibility promise yet.
- The `openclaw` CLI, Gateway, data formats, providers, channels, and companion apps remain
  upstream-owned surfaces unless a Workbench change explicitly says otherwise.
- Workbench-owned surfaces are the setup launchers and scripts, the Workbench page and navigation
  defaults, the Guardrails plugin, and the documentation under `docs/workbench/`.
- A feature present upstream is not automatically verified by Workbench merely because its source
  is included in this repository.

Use this repository's Issues tab for non-sensitive defects in Workbench-owned surfaces. Route
inherited OpenClaw behavior to upstream only after confirming the same problem exists there. Never
put exploit details, credentials, or an unpatched vulnerability in a public issue. For sensitive
Workbench-owned findings, use GitHub's
[private vulnerability report](../../security/advisories/new). The
[support and security scope](docs/workbench/index.md#support-and-security-scope) explains ownership
and the confidential fallback if that form is unavailable.

## Workbench contributor

- [@supermansuper563-ops](https://github.com/supermansuper563-ops) — creator and maintainer of the
  Workbench additions.

## Upstream credit

Workbench is built on [OpenClaw](https://github.com/openclaw/openclaw), created and maintained by
the OpenClaw Foundation and its contributors. The Workbench additions are downstream work and
should not be presented as upstream features or endorsements.

The repository remains under the [MIT License](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for incorporated and adapted code. Upstream
history records the upstream contributors.
