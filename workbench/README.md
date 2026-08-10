# Workbench source setup

These launchers turn an inspected OpenClaw Workbench checkout into a working local installation.
They install the pinned dependencies, build OpenClaw and the Control UI, optionally run interactive
onboarding, enable Workbench Guardrails and Workboard, restart the Gateway, verify runtime health,
and open the dashboard.

The scripts operate on the repository that contains them. They do not clone a hard-coded personal
fork, pipe a changing network response into a shell, or hide a second installer. Provider and
channel credentials remain in OpenClaw's normal onboarding and credential stores.

## Windows double-click path

From an extracted source archive or Git checkout, double-click
`OpenClaw-Workbench-Setup.cmd`. The launcher calls the adjacent `install.ps1` without bypassing
PowerShell execution policy and forwards any command-line options.

When Git or a supported Node.js runtime is missing, the PowerShell installer can request the
official `Git.Git` and `OpenJS.NodeJS.LTS` packages through `winget`. It never evaluates a
downloaded PowerShell script. The launcher and installer never bootstrap packages in Doctor or
DryRun mode.

## PowerShell modes

```powershell
# First installation: build, onboard, enable, verify, and open
.\workbench\install.ps1

# Preview every mutating command
.\workbench\install.ps1 -DryRun -SkipOnboarding -NoOpen

# Fetch, inspect, confirm, and fast-forward a clean checkout
.\workbench\install.ps1 -Mode Update -SkipOnboarding

# Rebuild and reapply the Workbench foundation without onboarding
.\workbench\install.ps1 -Mode Repair -SkipOnboarding

# Run only deep Gateway, doctor, and enabled-plugin checks
.\workbench\install.ps1 -Mode Doctor -NoOpen
```

Use `-SourceDirectory` to target another inspected checkout. Update mode accepts `-Ref` for an
explicit branch, tag, or commit-like revision. It fetches into `FETCH_HEAD`, prints the current and
fetched commit IDs plus a diff stat, and defaults to no at an approval prompt before changing the
checkout or building. Automation can replace the prompt with `-ExpectedCommit` and a full 40- or
64-character commit ID; a mismatch stops before checkout, merge, dependency installation, or
build. Update also rejects traversal syntax, option-shaped refs, non-Git checkouts, dirty working
trees, and origins that are not a GitHub repository named `openclaw-workbench`.

## macOS, Linux, and WSL

Install Git and a supported official Node.js release through the operating system's trusted
package source, then run:

```bash
bash ./workbench/install.sh
```

The Bash script supports the equivalent `--mode`, `--source`, `--ref`, `--expected-commit`,
`--dry-run`, `--skip-onboarding`, and `--no-open` options. It deliberately stops when Node.js or
Git is absent instead of piping a remote bootstrap into a privileged shell.

Node.js 25 and later do not include Corepack. When Corepack is absent, Install, Update, and Repair
provision exactly `corepack@0.34.7` through npm with lifecycle scripts disabled, then verify that
version before continuing. Doctor never provisions it. DryRun only prints the pinned provisioning
command and never runs npm.

## Safety and recovery behavior

- Setup requires at least 4 GiB of free space by default and stops before package installation
  when that check fails. The threshold can be raised with `-MinimumFreeBytes` on PowerShell or
  `OPENCLAW_WORKBENCH_MIN_FREE_KIB` on Bash.
- Update mode only performs a confirmed, commit-bound fast-forward or explicit detached revision
  checkout. Declining approval can update Git's `FETCH_HEAD`, but it leaves `HEAD`, the working
  tree, dependencies, and build output unchanged.
- A failed run does not delete the source checkout, state, credentials, or workspace. Correct the
  reported condition and use repair mode.
- Doctor and dry-run modes never install packages. Dry-run mode does not change source, services,
  configuration, or the browser.
- The final acceptance path runs `gateway status --deep`, `doctor --lint`, and an enabled-plugin
  listing. A green setup message appears only after those commands succeed.

This remains a source setup flow, not a signed native installer. Review the local scripts and the
pinned lockfile before running them on a sensitive host.
