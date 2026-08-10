#!/usr/bin/env bash
set -euo pipefail

mode="install"
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
requested_ref=""
expected_commit=""
dry_run=0
skip_onboarding=0
no_open=0
minimum_free_kib="${OPENCLAW_WORKBENCH_MIN_FREE_KIB:-4194304}"
repository_pattern='^(https://github\.com/[^/[:space:]]+/openclaw-workbench(\.git)?|git@github\.com:[^/[:space:]]+/openclaw-workbench(\.git)?)$'
ref_pattern='^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
expected_commit_pattern='^([0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$'
corepack_version="0.34.7"
supported_node_message="Node.js 22.22.3+, 24.15+, or 25.9+ (including later major versions) is required."

usage() {
  cat <<'EOF'
Usage: bash ./workbench/install.sh [options]

Options:
  --mode install|update|repair|doctor
  --source <directory>       OpenClaw Workbench source directory
  --ref <revision>           Explicit Git revision for update mode
  --expected-commit <sha>    Approve only this full fetched commit ID
  --dry-run                  Print mutating commands without running them
  --skip-onboarding          Do not run interactive onboarding
  --no-open                  Do not launch a browser after verification
  --help                     Show this help
EOF
}

die() {
  printf '\nOpenClaw Workbench setup stopped: %s\n' "$1" >&2
  printf '%s\n' "No cleanup was attempted. Fix the reported condition, then rerun the same mode." >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$1"
}

notice() {
  printf '    %s\n' "$1"
}

print_command() {
  printf '    '
  printf '%q ' "$@"
  printf '\n'
}

run() {
  local failure_message="$1"
  shift
  print_command "$@"
  if ((dry_run)); then
    return 0
  fi
  if ! "$@"; then
    die "$failure_message"
  fi
}

supported_node() {
  command -v node >/dev/null 2>&1 &&
    node -e "const [a,b,c]=process.versions.node.split('.').map(Number);process.exit(((a===22&&(b>22||(b===22&&c>=3)))||(a===24&&(b>15||(b===15&&c>=0)))||(a===25&&(b>9||(b===9&&c>=0)))||a>25)?0:1)"
}

require_supported_node() {
  supported_node ||
    die "$supported_node_message Install a supported official release; this script will not pipe a remote installer into a shell."
}

safe_ref() {
  local value="$1"
  [[ "$value" =~ $ref_pattern ]] &&
    [[ "$value" != -* ]] &&
    [[ "$value" != .* ]] &&
    [[ "$value" != *..* ]] &&
    [[ "$value" != *//* ]]
}

resolve_source() {
  [[ -d "$source_dir" ]] || die "Source directory does not exist: $source_dir"
  source_dir="$(cd -- "$source_dir" && pwd -P)"
  local required
  for required in package.json pnpm-lock.yaml openclaw.mjs workbench; do
    [[ -e "$source_dir/$required" ]] ||
      die "The selected source directory is not an OpenClaw Workbench checkout; missing $required."
  done
  node -e '
    const fs = require("node:fs");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    } catch {
      process.exit(1);
    }
    const valid = manifest !== null && !Array.isArray(manifest) &&
      typeof manifest === "object" &&
      Object.prototype.hasOwnProperty.call(manifest, "name") &&
      typeof manifest.name === "string" && manifest.name === "openclaw";
    process.exit(valid ? 0 : 1);
  ' "$source_dir/package.json" ||
    die "The selected source manifest is not the OpenClaw package."
}

ensure_corepack() {
  if command -v corepack >/dev/null 2>&1; then
    notice "Corepack: $(corepack --version)"
    return
  fi

  local provisioning_message npm_arguments installed_version
  provisioning_message="Corepack is unavailable. Mutating setup modes provision pinned corepack@$corepack_version from npm with lifecycle scripts disabled."
  if [[ "$mode" == "doctor" ]]; then
    die "$provisioning_message Doctor is check-only; install that exact package deliberately, then rerun Doctor."
  fi
  command -v npm >/dev/null 2>&1 ||
    die "$provisioning_message npm is unavailable; install corepack@$corepack_version deliberately, then rerun setup."
  npm_arguments=(
    install
    --global
    --ignore-scripts
    --no-audit
    --no-fund
    "corepack@$corepack_version"
  )
  if ((dry_run)); then
    notice "$provisioning_message DryRun will print the command without running it."
    run "Could not provision pinned Corepack." npm "${npm_arguments[@]}"
    return
  fi

  step "Provisioning pinned Corepack"
  run "Could not provision pinned Corepack." npm "${npm_arguments[@]}"
  hash -r
  command -v corepack >/dev/null 2>&1 ||
    die "corepack@$corepack_version was installed but is not on PATH. Reopen the shell, then rerun setup."
  installed_version="$(corepack --version)" || die "Could not verify the provisioned Corepack version."
  [[ "$installed_version" == "$corepack_version" ]] ||
    die "Expected Corepack $corepack_version after provisioning, but found $installed_version."
  notice "Corepack: $installed_version"
}

check_prerequisites() {
  step "Checking prerequisites"
  command -v git >/dev/null 2>&1 ||
    die "Git is required. Install it from your operating system's official package source, then rerun setup."
  notice "$(git --version)"
  notice "Node.js: $(node --version)"
  ensure_corepack
}

check_free_space() {
  [[ "$minimum_free_kib" =~ ^[0-9]+$ ]] || die "OPENCLAW_WORKBENCH_MIN_FREE_KIB must be an integer."
  local available_kib
  available_kib="$(df -Pk "$source_dir" | awk 'NR == 2 {print $4}')"
  [[ "$available_kib" =~ ^[0-9]+$ ]] || die "Could not determine available disk space."
  notice "Free space: $((available_kib / 1024)) MiB (minimum for setup: $((minimum_free_kib / 1024)) MiB)."
  if ((available_kib < minimum_free_kib)) && ((dry_run == 0)); then
    die "Not enough free disk space. Free at least $((minimum_free_kib / 1024)) MiB before setup."
  fi
}

show_fetched_update() {
  local old_commit="$1"
  local new_commit="$2"
  local diff_stat
  notice "Current commit: $old_commit"
  notice "Fetched commit: $new_commit"
  step "Fetched change summary"
  diff_stat="$(
    git -C "$source_dir" --no-pager diff --no-ext-diff --no-textconv --stat \
      "$old_commit" "$new_commit" --
  )" || die "Could not summarize the fetched changes."
  if [[ -n "$diff_stat" ]]; then
    printf '%s\n' "$diff_stat"
  else
    notice "No file changes between the current and fetched commits."
  fi
}

confirm_fetched_update() {
  local new_commit="$1"
  local response
  if [[ -n "$expected_commit" ]]; then
    [[ "$new_commit" == "$expected_commit" ]] ||
      die "Fetched commit $new_commit does not match --expected-commit $expected_commit. The checkout was not changed."
    notice "Fetched commit matches the exact expected commit."
    return
  fi

  printf 'Apply fetched commit %s and continue with dependency installation and build? [y/N] ' "$new_commit"
  if ! IFS= read -r response; then
    response=""
  fi
  case "$response" in
    y|Y|yes|YES|Yes) ;;
    *)
      die "Update was not approved. The checkout was not changed. For automation, rerun with --expected-commit $new_commit."
      ;;
  esac
}

update_source() {
  step "Inspecting the existing Git checkout"
  local remote dirty branch commit old_commit detach bare_repository inside_work_tree git_top_level
  bare_repository="$(git -C "$source_dir" rev-parse --is-bare-repository 2>/dev/null)" ||
    die "Update mode requires a Git working tree. Download a fresh source archive for a non-Git installation."
  [[ "$bare_repository" == "false" ]] ||
    die "Update mode refuses bare Git repositories; select a normal checkout or linked worktree."
  inside_work_tree="$(git -C "$source_dir" rev-parse --is-inside-work-tree 2>/dev/null)" ||
    die "Update mode requires a Git working tree. Download a fresh source archive for a non-Git installation."
  [[ "$inside_work_tree" == "true" ]] ||
    die "Update mode requires a Git working tree. Download a fresh source archive for a non-Git installation."
  git_top_level="$(git -C "$source_dir" rev-parse --show-toplevel)" ||
    die "Could not locate the Git working-tree root."
  git_top_level="$(cd -- "$git_top_level" && pwd -P)" ||
    die "Could not resolve the Git working-tree root."
  [[ "$git_top_level" == "$source_dir" ]] ||
    die "Update mode requires the selected source directory to be the Git working-tree root."

  remote="$(git -C "$source_dir" remote get-url origin)" || die "Could not read origin."
  [[ "$remote" =~ $repository_pattern ]] ||
    die "Refusing to update from an unexpected origin: $remote"
  notice "Origin matches a GitHub openclaw-workbench repository."

  dirty="$(git -C "$source_dir" status --porcelain --untracked-files=normal)" ||
    die "Could not inspect the checkout."
  [[ -z "$dirty" ]] ||
    die "The checkout has local changes. Commit, copy, or discard them deliberately before updating."

  old_commit="$(git -C "$source_dir" rev-parse --verify 'HEAD^{commit}')" ||
    die "Could not read the current commit."
  detach=0
  if [[ -n "$requested_ref" ]]; then
    safe_ref "$requested_ref" ||
      die "Ref contains unsupported characters or traversal syntax: $requested_ref"
    step "Fetching the requested revision"
    run "Could not fetch the requested revision." \
      git -C "$source_dir" -c protocol.file.allow=never fetch --no-tags --depth=1 origin "$requested_ref"
    detach=1
  else
    branch="$(git -C "$source_dir" branch --show-current)" || die "Could not read the current branch."
    [[ -n "$branch" ]] ||
      die "The checkout is detached. Pass --ref with an explicit commit or branch to update it."
    safe_ref "$branch" || die "The current branch name is not safe to pass to Git: $branch"
    step "Fetching the current branch"
    run "Could not fetch the current branch." \
      git -C "$source_dir" -c protocol.file.allow=never fetch --prune --no-tags origin "$branch"
  fi

  if ((dry_run)); then
    notice "Current commit: $old_commit"
    notice "DryRun did not fetch or inspect FETCH_HEAD. A real update shows the fetched commit and diff stat, then requires confirmation or an exact expected commit."
    if [[ -n "$expected_commit" ]]; then
      notice "Expected commit for a real update: $expected_commit"
    fi
    if ((detach)); then
      run "Could not check out the requested revision." \
        git -C "$source_dir" checkout --detach 'FETCH_HEAD^{commit}'
    else
      run "The checkout could not be fast-forwarded." \
        git -C "$source_dir" merge --ff-only 'FETCH_HEAD^{commit}'
    fi
    return
  fi

  commit="$(git -C "$source_dir" rev-parse --verify 'FETCH_HEAD^{commit}')" ||
    die "The fetched revision is not a commit."
  show_fetched_update "$old_commit" "$commit"
  confirm_fetched_update "$commit"

  if ((detach)); then
    run "Could not check out the requested revision." \
      git -C "$source_dir" checkout --detach "$commit"
    return
  fi

  git -C "$source_dir" merge-base --is-ancestor "$old_commit" "$commit" ||
    die "The fetched commit is not a fast-forward of the current branch. The checkout was not changed."
  run "The checkout could not be fast-forwarded." \
    git -C "$source_dir" merge --ff-only "$commit"
}

openclaw() {
  local failure_message="$1"
  shift
  run "$failure_message" corepack pnpm openclaw "$@"
}

doctor() {
  step "Checking Gateway and plugin health"
  local previous_corepack_network=""
  local previous_corepack_network_set=0
  if [[ "${COREPACK_ENABLE_NETWORK+x}" == x ]]; then
    previous_corepack_network="$COREPACK_ENABLE_NETWORK"
    previous_corepack_network_set=1
  fi
  export COREPACK_ENABLE_NETWORK=0
  openclaw "Gateway deep status failed." gateway status --deep
  openclaw "OpenClaw doctor reported a blocking problem." doctor --lint
  openclaw "Could not list enabled plugins." plugins list --enabled --verbose
  if ((previous_corepack_network_set)); then
    export COREPACK_ENABLE_NETWORK="$previous_corepack_network"
  else
    unset COREPACK_ENABLE_NETWORK
  fi
}

while (($#)); do
  case "$1" in
    --mode)
      (($# >= 2)) || die "--mode requires a value."
      mode="$2"
      shift 2
      ;;
    --source)
      (($# >= 2)) || die "--source requires a directory."
      source_dir="$2"
      shift 2
      ;;
    --ref)
      (($# >= 2)) || die "--ref requires a revision."
      requested_ref="$2"
      shift 2
      ;;
    --expected-commit)
      (($# >= 2)) || die "--expected-commit requires a full commit ID."
      expected_commit="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-onboarding)
      skip_onboarding=1
      shift
      ;;
    --no-open)
      no_open=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

case "$mode" in
  install|update|repair|doctor) ;;
  *) die "Mode must be install, update, repair, or doctor." ;;
esac
[[ "$mode" == "update" || -z "$requested_ref" ]] || die "--ref is valid only with --mode update."
[[ "$mode" == "update" || -z "$expected_commit" ]] ||
  die "--expected-commit is valid only with --mode update."
if [[ -n "$expected_commit" ]]; then
  [[ "$expected_commit" =~ $expected_commit_pattern ]] ||
    die "--expected-commit must be a full 40- or 64-character hexadecimal commit ID."
  expected_commit="$(printf '%s' "$expected_commit" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
fi

require_supported_node
resolve_source
mode_label="$mode"
if ((dry_run)); then
  mode_label+=" (dry run)"
fi
printf '%s\n' "OpenClaw Workbench source setup"
notice "Source: $source_dir"
notice "Mode: $mode_label"
notice "Setup can install dependencies, build source, install a user service, change plugin configuration, restart the Gateway, and open a browser."

check_prerequisites
if [[ "$mode" == "update" ]]; then
  update_source
fi

cd -- "$source_dir"
if [[ "$mode" == "doctor" ]]; then
  doctor
  printf '\n%s\n' "Workbench diagnostics completed."
  exit 0
fi

check_free_space
step "Installing dependencies from the pinned lockfile"
run "Dependency installation failed." corepack pnpm install --frozen-lockfile

step "Building OpenClaw and the Workbench Control UI"
run "OpenClaw build failed." corepack pnpm build

if [[ "$mode" == "install" && $skip_onboarding -eq 0 ]]; then
  step "Running interactive OpenClaw onboarding"
  openclaw "Onboarding did not complete." onboard --install-daemon
else
  notice "Interactive onboarding skipped for this run."
fi

step "Enabling Workbench Guardrails and Workboard"
openclaw "Could not enable Workbench Guardrails." plugins enable workbench-guardrails
openclaw "Could not enable Workboard." plugins enable workboard

step "Restarting the Gateway"
openclaw "Could not restart the Gateway." gateway restart
doctor

if ((no_open == 0)); then
  step "Opening the Control UI"
  openclaw "Could not open the dashboard." dashboard
else
  notice "Browser launch skipped. Run: corepack pnpm openclaw dashboard"
fi

if ((dry_run)); then
  printf '\n%s\n' "Dry run complete; no package, source, service, configuration, or browser changes were made."
else
  printf '\nOpenClaw Workbench is ready from %s\n' "$source_dir"
fi
