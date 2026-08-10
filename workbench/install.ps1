[CmdletBinding()]
param(
  [ValidateSet("Install", "Update", "Repair", "Doctor")]
  [string]$Mode = "Install",
  [string]$SourceDirectory = (Join-Path $PSScriptRoot ".."),
  [string]$Ref = "",
  [string]$ExpectedCommit = "",
  [switch]$DryRun,
  [switch]$SkipOnboarding,
  [switch]$NoOpen,
  [long]$MinimumFreeBytes = 4GB
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SupportedNodeMessage = "Node.js 22.22.3+, 24.15+, or 25.9+ (including later major versions) is required."
$CorepackVersion = "0.34.7"
$RepositoryPattern = "^(?:https://github\.com/[^/\s]+/openclaw-workbench(?:\.git)?|git@github\.com:[^/\s]+/openclaw-workbench(?:\.git)?)$"
$RefPattern = "^(?![-.])(?!.*\.\.)(?!.*//)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$"
$ExpectedCommitPattern = "^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Notice([string]$Message) {
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Format-Command([string]$Executable, [string[]]$Arguments) {
  $display = @($Executable)
  foreach ($argument in $Arguments) {
    $display += '"' + ($argument -replace '"', '""') + '"'
  }
  return $display -join " "
}

function Invoke-External(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$FailureMessage
) {
  Write-Notice (Format-Command $Executable $Arguments)
  if ($DryRun) {
    return
  }
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
}

function Read-External([string]$Executable, [string[]]$Arguments, [string]$FailureMessage) {
  $output = & $Executable @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
  return ($output | Out-String).Trim()
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $separator = [IO.Path]::PathSeparator
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $merged = [Collections.Generic.List[string]]::new()

  foreach ($pathValue in @($env:Path, $machinePath, $userPath)) {
    if ([String]::IsNullOrWhiteSpace($pathValue)) {
      continue
    }
    foreach ($entry in ($pathValue -split [Regex]::Escape([string]$separator))) {
      $candidate = $entry.Trim()
      if (-not [String]::IsNullOrWhiteSpace($candidate) -and $seen.Add($candidate)) {
        $merged.Add($candidate)
      }
    }
  }

  $env:Path = $merged -join $separator
}

function Test-SupportedNode {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    return $false
  }
  & node -e "const [a,b,c]=process.versions.node.split('.').map(Number);process.exit(((a===22&&(b>22||(b===22&&c>=3)))||(a===24&&(b>15||(b===15&&c>=0)))||(a===25&&(b>9||(b===9&&c>=0)))||a>25)?0:1)"
  return $LASTEXITCODE -eq 0
}

function Install-WingetPackage([string]$Id, [string]$Label) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "$Label is required and winget is unavailable. Install it from its official source, then rerun setup."
  }
  Invoke-External "winget" @(
    "install",
    "--id",
    $Id,
    "--exact",
    "--source",
    "winget",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity"
  ) "Could not install $Label"
  if (-not $DryRun) {
    Refresh-ProcessPath
  }
}

function Ensure-Corepack([bool]$AllowProvisioning) {
  $corepack = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepack) {
    Write-Notice ("Corepack: " + (Read-External "corepack" @("--version") "Could not read the Corepack version"))
    return
  }

  $provisioningMessage = "Corepack is unavailable. Mutating setup modes provision the pinned corepack@$CorepackVersion package from npm with lifecycle scripts disabled."
  if ($Mode -eq "Doctor") {
    throw "$provisioningMessage Doctor is check-only; install that exact package deliberately, then rerun Doctor."
  }

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  $npmExecutable = if ($npmCommand) { $npmCommand.Source } else { "npm" }
  $npmArguments = @(
    "install",
    "--global",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "corepack@$CorepackVersion"
  )

  if ($DryRun) {
    Write-Notice "$provisioningMessage DryRun will print the command without running it."
    Invoke-External $npmExecutable $npmArguments "Could not provision pinned Corepack"
    return
  }
  if (-not $AllowProvisioning) {
    throw "$provisioningMessage Automatic provisioning is disabled for this mode."
  }
  if (-not $npmCommand) {
    throw "$provisioningMessage npm is unavailable; install corepack@$CorepackVersion deliberately, then rerun setup."
  }

  Write-Step "Provisioning pinned Corepack"
  Invoke-External $npmExecutable $npmArguments "Could not provision pinned Corepack"
  Refresh-ProcessPath
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    throw "corepack@$CorepackVersion was installed but is not on PATH. Reopen the terminal, then rerun setup."
  }
  $installedVersion = Read-External "corepack" @("--version") "Could not verify the provisioned Corepack version"
  if (-not [String]::Equals($installedVersion, $CorepackVersion, [StringComparison]::Ordinal)) {
    throw "Expected Corepack $CorepackVersion after provisioning, but found $installedVersion."
  }
  Write-Notice "Corepack: $installedVersion"
}

function Ensure-Prerequisites([bool]$AllowProvisioning) {
  Write-Step "Checking prerequisites"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not $AllowProvisioning) {
      throw "Git is required. Doctor and DryRun do not install packages; install Git deliberately, then rerun setup."
    }
    Write-Notice "Git is missing; setup will request the official Git.Git winget package."
    Install-WingetPackage "Git.Git" "Git"
  }
  Write-Notice ("Git: " + (Read-External "git" @("--version") "Could not read the Git version"))

  if (-not (Test-SupportedNode)) {
    if (-not $AllowProvisioning) {
      throw "$SupportedNodeMessage Doctor and DryRun do not install packages; install Node.js deliberately, then rerun setup."
    }
    Write-Notice $SupportedNodeMessage
    Write-Notice "Setup will request the official OpenJS.NodeJS.LTS winget package; no downloaded script will be evaluated."
    Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
  }

  if (-not (Test-SupportedNode)) {
    throw $SupportedNodeMessage
  }
  Write-Notice ("Node.js: " + (& node --version))
  Ensure-Corepack $AllowProvisioning
}

function Resolve-WorkbenchSource([string]$Candidate) {
  if (-not (Test-Path -LiteralPath $Candidate -PathType Container)) {
    throw "Source directory does not exist: $Candidate"
  }
  $resolved = (Resolve-Path -LiteralPath $Candidate).Path
  $required = @("package.json", "pnpm-lock.yaml", "openclaw.mjs", "workbench")
  foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolved $name))) {
      throw "The selected source directory is not an OpenClaw Workbench checkout; missing $name."
    }
  }
  $manifestText = Get-Content -LiteralPath (Join-Path $resolved "package.json") -Raw
  if (-not $manifestText.TrimStart().StartsWith("{", [StringComparison]::Ordinal)) {
    throw "The selected source manifest must be a top-level JSON object."
  }
  $manifest = $manifestText | ConvertFrom-Json
  $hasName = $manifest -is [PSCustomObject] -and
    $manifest.PSObject.Properties.Name -ccontains "name" -and
    $manifest.name -is [string]
  if (-not $hasName -or -not [String]::Equals($manifest.name, "openclaw", [StringComparison]::Ordinal)) {
    throw "The selected source manifest is not the OpenClaw package."
  }
  return $resolved
}

function Assert-FreeSpace([string]$Path) {
  $root = [System.IO.Path]::GetPathRoot($Path)
  $drive = Get-PSDrive -Name $root.Substring(0, 1)
  $available = [long]$drive.Free
  $neededGiB = [Math]::Round($MinimumFreeBytes / 1GB, 1)
  $availableGiB = [Math]::Round($available / 1GB, 1)
  Write-Notice "Free space: $availableGiB GiB (minimum for setup: $neededGiB GiB)."
  if ($available -lt $MinimumFreeBytes -and -not $DryRun) {
    throw "Not enough free disk space. Free at least $neededGiB GiB on $root before setup."
  }
}

function Assert-SafeRepository([string]$Remote) {
  if ($Remote -notmatch $RepositoryPattern) {
    throw "Refusing to update from an unexpected origin: $Remote"
  }
}

function Assert-SafeRef([string]$Value) {
  if ($Value -notmatch $RefPattern) {
    throw "Ref contains unsupported characters or traversal syntax: $Value"
  }
}

function Assert-ExpectedCommit([string]$Value) {
  if ($Value -notmatch $ExpectedCommitPattern) {
    throw "-ExpectedCommit must be a full 40- or 64-character hexadecimal commit ID."
  }
}

function Show-FetchedUpdate([string]$Path, [string]$OldCommit, [string]$NewCommit) {
  Write-Notice "Current commit: $OldCommit"
  Write-Notice "Fetched commit: $NewCommit"
  Write-Step "Fetched change summary"
  $diffStat = Read-External "git" @(
    "-C",
    $Path,
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--stat",
    $OldCommit,
    $NewCommit,
    "--"
  ) "Could not summarize the fetched changes"
  if ($diffStat) {
    Write-Host $diffStat
  } else {
    Write-Notice "No file changes between the current and fetched commits."
  }
}

function Confirm-FetchedUpdate([string]$NewCommit) {
  if ($ExpectedCommit) {
    if (-not [String]::Equals($ExpectedCommit, $NewCommit, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Fetched commit $NewCommit does not match -ExpectedCommit $ExpectedCommit. The checkout was not changed."
    }
    Write-Notice "Fetched commit matches the exact expected commit."
    return
  }

  $response = Read-Host "Apply fetched commit $NewCommit and continue with dependency installation and build? [y/N]"
  if ($response -notmatch "^(?i:y|yes)$") {
    throw "Update was not approved. The checkout was not changed. For automation, rerun with -ExpectedCommit $NewCommit."
  }
}

function Update-WorkbenchSource([string]$Path) {
  Write-Step "Inspecting the existing Git checkout"
  $bareRepository = Read-External "git" @(
    "-C",
    $Path,
    "rev-parse",
    "--is-bare-repository"
  ) "Update mode requires a Git working tree"
  if (-not [String]::Equals($bareRepository, "false", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update mode refuses bare Git repositories; select a normal checkout or linked worktree."
  }
  $insideWorkTree = Read-External "git" @(
    "-C",
    $Path,
    "rev-parse",
    "--is-inside-work-tree"
  ) "Update mode requires a Git working tree"
  if (-not [String]::Equals($insideWorkTree, "true", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update mode requires a Git working tree. Download a fresh source archive for a non-Git installation."
  }
  $topLevel = Read-External "git" @(
    "-C",
    $Path,
    "rev-parse",
    "--show-toplevel"
  ) "Could not locate the Git working-tree root"
  $resolvedTopLevel = (Resolve-Path -LiteralPath $topLevel).Path
  if (-not [String]::Equals($resolvedTopLevel, $Path, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update mode requires the selected source directory to be the Git working-tree root."
  }
  $remote = Read-External "git" @("-C", $Path, "remote", "get-url", "origin") "Could not read origin"
  Assert-SafeRepository $remote
  Write-Notice "Origin matches a GitHub openclaw-workbench repository."
  $dirty = Read-External "git" @(
    "-C",
    $Path,
    "status",
    "--porcelain",
    "--untracked-files=normal"
  ) "Could not inspect the checkout"
  if ($dirty) {
    throw "The checkout has local changes. Commit, copy, or discard them deliberately before updating."
  }

  $oldCommit = Read-External "git" @(
    "-C",
    $Path,
    "rev-parse",
    "--verify",
    "HEAD^{commit}"
  ) "Could not read the current commit"
  $detach = $false
  if ($Ref) {
    Assert-SafeRef $Ref
    Write-Step "Fetching the requested revision"
    Invoke-External "git" @(
      "-C",
      $Path,
      "-c",
      "protocol.file.allow=never",
      "fetch",
      "--no-tags",
      "--depth=1",
      "origin",
      $Ref
    ) "Could not fetch the requested revision"
    $detach = $true
  } else {
    $branch = Read-External "git" @("-C", $Path, "branch", "--show-current") "Could not read the current branch"
    if (-not $branch) {
      throw "The checkout is detached. Pass -Ref with an explicit commit or branch to update it."
    }
    Assert-SafeRef $branch
    Write-Step "Fetching the current branch"
    Invoke-External "git" @(
      "-C",
      $Path,
      "-c",
      "protocol.file.allow=never",
      "fetch",
      "--prune",
      "--no-tags",
      "origin",
      $branch
    ) "Could not fetch the current branch"
  }

  if ($DryRun) {
    Write-Notice "Current commit: $oldCommit"
    Write-Notice "DryRun did not fetch or inspect FETCH_HEAD. A real update shows the fetched commit and diff stat, then requires confirmation or an exact expected commit."
    if ($ExpectedCommit) {
      Write-Notice "Expected commit for a real update: $ExpectedCommit"
    }
    if ($detach) {
      Invoke-External "git" @("-C", $Path, "checkout", "--detach", "FETCH_HEAD^{commit}") "Could not check out the revision"
    } else {
      Invoke-External "git" @("-C", $Path, "merge", "--ff-only", "FETCH_HEAD^{commit}") "The checkout could not be fast-forwarded"
    }
    return
  }

  $commit = Read-External "git" @(
    "-C",
    $Path,
    "rev-parse",
    "--verify",
    "FETCH_HEAD^{commit}"
  ) "The fetched revision is not a commit"
  Show-FetchedUpdate $Path $oldCommit $commit
  Confirm-FetchedUpdate $commit

  if ($detach) {
    Invoke-External "git" @("-C", $Path, "checkout", "--detach", $commit) "Could not check out the revision"
    return
  }

  & git -C $Path merge-base --is-ancestor $oldCommit $commit 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The fetched commit is not a fast-forward of the current branch. The checkout was not changed."
  }
  Invoke-External "git" @("-C", $Path, "merge", "--ff-only", $commit) "The checkout could not be fast-forwarded"
}

function Invoke-OpenClaw([string[]]$Arguments, [string]$FailureMessage) {
  Invoke-External "corepack" (@("pnpm", "openclaw") + $Arguments) $FailureMessage
}

function Invoke-Doctor {
  Write-Step "Checking Gateway and plugin health"
  $previousCorepackNetwork = $env:COREPACK_ENABLE_NETWORK
  try {
    $env:COREPACK_ENABLE_NETWORK = "0"
    Invoke-OpenClaw @("gateway", "status", "--deep") "Gateway deep status failed"
    Invoke-OpenClaw @("doctor", "--lint") "OpenClaw doctor reported a blocking problem"
    Invoke-OpenClaw @("plugins", "list", "--enabled", "--verbose") "Could not list enabled plugins"
  } finally {
    if ($null -eq $previousCorepackNetwork) {
      Remove-Item Env:COREPACK_ENABLE_NETWORK -ErrorAction SilentlyContinue
    } else {
      $env:COREPACK_ENABLE_NETWORK = $previousCorepackNetwork
    }
  }
}

try {
  if ($Ref -and $Mode -ne "Update") {
    throw "-Ref is valid only with -Mode Update."
  }
  if ($ExpectedCommit -and $Mode -ne "Update") {
    throw "-ExpectedCommit is valid only with -Mode Update."
  }
  if ($ExpectedCommit) {
    Assert-ExpectedCommit $ExpectedCommit
  }
  if ($MinimumFreeBytes -lt 0) {
    throw "-MinimumFreeBytes cannot be negative."
  }
  $source = Resolve-WorkbenchSource $SourceDirectory
  Write-Host "OpenClaw Workbench source setup" -ForegroundColor Green
  Write-Notice "Source: $source"
  Write-Notice "Mode: $Mode$(if ($DryRun) { ' (dry run)' } else { '' })"
  Write-Notice "Setup can install Git/Node.js through winget, install dependencies, build source, install a user service, change plugin configuration, restart the Gateway, and open a browser."

  $allowProvisioning = -not $DryRun -and $Mode -ne "Doctor"
  Ensure-Prerequisites $allowProvisioning
  if ($Mode -eq "Update") {
    Update-WorkbenchSource $source
  }

  if ($Mode -eq "Doctor") {
    Push-Location $source
    try {
      Invoke-Doctor
    } finally {
      Pop-Location
    }
    Write-Host "`nWorkbench diagnostics completed." -ForegroundColor Green
    exit 0
  }

  Assert-FreeSpace $source
  Push-Location $source
  try {
    Write-Step "Installing dependencies from the pinned lockfile"
    Invoke-External "corepack" @("pnpm", "install", "--frozen-lockfile") "Dependency installation failed"

    Write-Step "Building OpenClaw and the Workbench Control UI"
    Invoke-External "corepack" @("pnpm", "build") "OpenClaw build failed"

    if ($Mode -eq "Install" -and -not $SkipOnboarding) {
      Write-Step "Running interactive OpenClaw onboarding"
      Invoke-OpenClaw @("onboard", "--install-daemon") "Onboarding did not complete"
    } else {
      Write-Notice "Interactive onboarding skipped for this run."
    }

    Write-Step "Enabling Workbench Guardrails and Workboard"
    Invoke-OpenClaw @("plugins", "enable", "workbench-guardrails") "Could not enable Workbench Guardrails"
    Invoke-OpenClaw @("plugins", "enable", "workboard") "Could not enable Workboard"

    Write-Step "Restarting the Gateway"
    Invoke-OpenClaw @("gateway", "restart") "Could not restart the Gateway"
    Invoke-Doctor

    if (-not $NoOpen) {
      Write-Step "Opening the Control UI"
      Invoke-OpenClaw @("dashboard") "Could not open the dashboard"
    } else {
      Write-Notice "Browser launch skipped. Run: corepack pnpm openclaw dashboard"
    }
  } finally {
    Pop-Location
  }

  if ($DryRun) {
    Write-Host "`nDry run complete; no package, source, service, configuration, or browser changes were made." -ForegroundColor Green
  } else {
    Write-Host "`nOpenClaw Workbench is ready from $source" -ForegroundColor Green
  }
} catch {
  Write-Host "`nOpenClaw Workbench setup stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "No cleanup was attempted. Fix the reported condition, then rerun the same mode." -ForegroundColor Yellow
  exit 1
}
