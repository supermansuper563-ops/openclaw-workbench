import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workbenchDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.dirname(workbenchDirectory);

async function read(relativePath) {
  return await readFile(path.join(repositoryDirectory, relativePath), "utf8");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function outputFor(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function runSuccessfully(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed with status ${result.status}:\n${outputFor(result)}`,
  );
  return result;
}

function commandIsAvailable(command) {
  const result = run(command, ["--version"]);
  return result.status === 0;
}

function currentNodeIsSupported() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  return (
    (major === 22 && (minor > 22 || (minor === 22 && patch >= 3))) ||
    (major === 24 && (minor > 15 || (minor === 15 && patch >= 0))) ||
    (major === 25 && (minor > 9 || (minor === 9 && patch >= 0))) ||
    major > 25
  );
}

async function writeSourceFixture(directory) {
  await mkdir(path.join(directory, "workbench"), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "package.json"), '{"name":"openclaw"}\n'),
    writeFile(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(path.join(directory, "openclaw.mjs"), "export {};\n"),
    writeFile(path.join(directory, "workbench", ".keep"), ""),
  ]);
}

function runNativeInstaller(sourceDirectory) {
  if (process.platform === "win32") {
    return run(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        path.join(workbenchDirectory, "install.ps1"),
        "-Mode",
        "Update",
        "-SourceDirectory",
        sourceDirectory,
        "-DryRun",
        "-SkipOnboarding",
        "-NoOpen",
        "-MinimumFreeBytes",
        "0",
      ],
      { cwd: repositoryDirectory },
    );
  }

  return run(
    "bash",
    [
      path.join(workbenchDirectory, "install.sh"),
      "--mode",
      "update",
      "--source",
      sourceDirectory,
      "--dry-run",
      "--skip-onboarding",
      "--no-open",
    ],
    {
      cwd: repositoryDirectory,
      env: { ...process.env, OPENCLAW_WORKBENCH_MIN_FREE_KIB: "0" },
    },
  );
}

test("launchers use inspected local source and never bypass script policy", async () => {
  const [launcher, powershell, shell] = await Promise.all([
    read("OpenClaw-Workbench-Setup.cmd"),
    read("workbench/install.ps1"),
    read("workbench/install.sh"),
  ]);
  const combined = `${launcher}\n${powershell}\n${shell}`;

  assert.doesNotMatch(combined, /ExecutionPolicy\s+Bypass/iu);
  assert.doesNotMatch(combined, /ScriptBlock\]::Create|Invoke-Expression|\biex\b/iu);
  assert.doesNotMatch(shell, /curl[^\n]*\|[^\n]*(?:ba)?sh/iu);
  assert.doesNotMatch(powershell, /Invoke-WebRequest|Invoke-RestMethod/iu);
  assert.doesNotMatch(combined, /C:\\Users\\|\/Users\/|\/home\//u);
  assert.match(launcher, /workbench\\install\.ps1" %\*/u);
  assert.match(launcher, /Microsoft\.PowerShell/u);
  assert.match(launcher, /pwsh\.exe/u);
  assert.match(launcher, /WORKBENCH_CHECK_ONLY/u);
  assert.ok(
    launcher.indexOf("for %%A in (%*)") < launcher.indexOf("winget.exe install"),
    "launcher must inspect Doctor/DryRun before any PowerShell bootstrap",
  );
  assert.match(powershell, /Join-Path \$PSScriptRoot "\.\."/u);
  assert.match(shell, /BASH_SOURCE\[0\]/u);
});

test("install plans are pinned, inspectable, recoverable, and verified", async () => {
  const [powershell, shell] = await Promise.all([
    read("workbench/install.ps1"),
    read("workbench/install.sh"),
  ]);
  for (const source of [powershell, shell]) {
    assert.match(source, /--frozen-lockfile/u);
    assert.match(source, /pnpm["', )]+build/u);
    assert.match(source, /plugins["', )]+enable["', )]+workbench-guardrails/u);
    assert.match(source, /plugins["', )]+enable["', )]+workboard/u);
    assert.match(source, /gateway["', )]+status["', )]+--deep/u);
    assert.match(source, /doctor["', )]+--lint/u);
    assert.match(source, /DryRun|dry_run/u);
    assert.match(source, /Update|update/u);
    assert.match(source, /Repair|repair/u);
    assert.match(source, /Doctor|doctor/u);
    assert.match(source, /openclaw-workbench/u);
    assert.match(source, /unexpected origin/u);
    assert.match(source, /a>25/u);
    assert.match(source, /corepack@\$?(?:CorepackVersion|corepack_version)/u);
    assert.match(source, /--ignore-scripts/u);
    assert.doesNotMatch(source, /corepack@latest/iu);
  }

  assert.equal((powershell.match(/@\("pnpm", "build"\)/gu) ?? []).length, 1);
  assert.equal((shell.match(/corepack pnpm build/gu) ?? []).length, 1);
  assert.doesNotMatch(powershell, /pnpm", "ui:build/u);
  assert.doesNotMatch(shell, /pnpm ui:build/u);
});

test("updates are commit-bound and approval-gated", async () => {
  const [powershell, shell] = await Promise.all([
    read("workbench/install.ps1"),
    read("workbench/install.sh"),
  ]);

  assert.match(powershell, /ExpectedCommit/u);
  assert.match(shell, /--expected-commit/u);
  for (const source of [powershell, shell]) {
    assert.match(source, /FETCH_HEAD\^\{commit\}/u);
    assert.match(source, /--no-ext-diff/u);
    assert.match(source, /--no-textconv/u);
    assert.match(source, /--stat/u);
    assert.match(source, /Current commit:/u);
    assert.match(source, /Fetched commit:/u);
    assert.doesNotMatch(source, /merge[^\n]*(?:origin\/\$branch|origin\/\$\{branch\})/u);
  }
  assert.match(powershell, /Read-Host[^\n]+\[y\/N\]/u);
  assert.match(shell, /read -r response/u);
  assert.match(powershell, /merge", "--ff-only", \$commit/u);
  assert.match(shell, /merge --ff-only "\$commit"/u);
});

test("update preflight accepts linked worktrees and rejects bare repositories", async (t) => {
  const nativeShell = process.platform === "win32" ? "pwsh" : "bash";
  if (
    !currentNodeIsSupported() ||
    !commandIsAvailable("git") ||
    !commandIsAvailable("corepack") ||
    !commandIsAvailable(nativeShell)
  ) {
    t.skip("native installer prerequisites are unavailable in this test environment");
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-workbench-installer-"));
  t.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  const primaryCheckout = path.join(temporaryRoot, "primary");
  const linkedCheckout = path.join(temporaryRoot, "linked");
  await mkdir(primaryCheckout, { recursive: true });
  runSuccessfully("git", ["init", primaryCheckout]);
  runSuccessfully("git", [
    "-C",
    primaryCheckout,
    "config",
    "user.email",
    "installer@example.invalid",
  ]);
  runSuccessfully("git", ["-C", primaryCheckout, "config", "user.name", "Installer Contract"]);
  await writeSourceFixture(primaryCheckout);
  runSuccessfully("git", ["-C", primaryCheckout, "add", "--all"]);
  runSuccessfully("git", ["-C", primaryCheckout, "commit", "-m", "fixture"]);
  runSuccessfully("git", [
    "-C",
    primaryCheckout,
    "remote",
    "add",
    "origin",
    "https://github.com/example/openclaw-workbench.git",
  ]);
  runSuccessfully("git", [
    "-C",
    primaryCheckout,
    "worktree",
    "add",
    "-b",
    "linked",
    linkedCheckout,
  ]);
  assert.equal((await stat(path.join(linkedCheckout, ".git"))).isFile(), true);

  const linkedResult = runNativeInstaller(linkedCheckout);
  assert.equal(linkedResult.status, 0, outputFor(linkedResult));
  assert.match(outputFor(linkedResult), /Dry run complete/iu);

  const bareRepository = path.join(temporaryRoot, "bare");
  runSuccessfully("git", ["init", "--bare", bareRepository]);
  await writeSourceFixture(bareRepository);
  const bareResult = runNativeInstaller(bareRepository);
  assert.notEqual(bareResult.status, 0, outputFor(bareResult));
  assert.match(outputFor(bareResult), /refuses bare Git repositories/iu);
});

test("worktree detection is Git-native and PATH refresh preserves inherited entries", async () => {
  const [powershell, shell] = await Promise.all([
    read("workbench/install.ps1"),
    read("workbench/install.sh"),
  ]);

  for (const source of [powershell, shell]) {
    assert.match(source, /--is-bare-repository/u);
    assert.match(source, /--is-inside-work-tree/u);
    assert.match(source, /--show-toplevel/u);
  }
  assert.doesNotMatch(powershell, /Test-Path[^\r\n]+\.git[^\r\n]+PathType Container/u);
  assert.doesNotMatch(shell, /\[\[ -d "\$source_dir\/\.git" \]\]/u);
  assert.match(powershell, /@\(\$env:Path, \$machinePath, \$userPath\)/u);
  assert.doesNotMatch(powershell, /\$env:Path\s*=\s*"\$machinePath;\$userPath"/u);
});

test("source identity checks parse an exact top-level JSON object", async () => {
  const [powershell, shell] = await Promise.all([
    read("workbench/install.ps1"),
    read("workbench/install.sh"),
  ]);

  assert.match(shell, /JSON\.parse/u);
  assert.match(shell, /!Array\.isArray\(manifest\)/u);
  assert.match(shell, /hasOwnProperty\.call\(manifest, "name"\)/u);
  assert.match(shell, /manifest\.name === "openclaw"/u);
  assert.doesNotMatch(shell, /grep[^\n]+package\.json/u);
  assert.match(powershell, /StartsWith\("\{"/u);
  assert.match(powershell, /StringComparison\]::Ordinal/u);
});

test("workflow checkouts do not persist credentials", async () => {
  const workflow = await read(".github/workflows/workbench-installers.yml");
  const checkoutCount = (workflow.match(/uses: actions\/checkout@/gu) ?? []).length;
  const protectedCheckoutCount = (
    workflow.match(
      /- name: Checkout\r?\n\s+uses: actions\/checkout@[^\r\n]+\r?\n\s+with:\r?\n\s+persist-credentials: false/gu,
    ) ?? []
  ).length;

  assert.equal(checkoutCount, 3);
  assert.equal(protectedCheckoutCount, checkoutCount);
  assert.match(workflow, /permissions:\r?\n\s+contents: read/u);
});

test("installer source has no hard-coded repository owner", async () => {
  const source = await read("workbench/install.ps1");
  const shell = await read("workbench/install.sh");
  const readme = await read("workbench/README.md");
  for (const text of [source, shell, readme]) {
    assert.doesNotMatch(text, /github\.com\/[A-Za-z0-9-]+\/openclaw-workbench(?:\.git)?/iu);
  }
});
