---
summary: "Workbench delivery status and acceptance criteria"
read_when:
  - You need to distinguish available Workbench behavior from planned work
  - You are evaluating a proposed Workbench feature
title: "Workbench roadmap"
---

This roadmap separates behavior that exists in the source tree from work that still needs design,
implementation, and proof. A roadmap item is not an availability promise.

## Available now

- A five-step setup wizard for Gateway, model, channel, Guardrails, and final review.
- A real model verification request and refreshed configured, running, and connected channel
  counts.
- Links from incomplete steps to the OpenClaw surface that owns the setting.
- Shortcuts into Workboard, Tasks, Automations, Memory, Dashboards, and Apps.
- A mission form that creates a labeled Workboard card and returns its identifier.
- Local Windows, macOS, Linux, and WSL source setup flows.
- A Windows launcher that starts setup after the repository has been downloaded.
- A Guardrails profile and approval-expiry chooser, active runtime check, recent journal view, and
  administrator-only journal clearing.
- The optional Workbench Guardrails plugin with four policy profiles, approval integration,
  mandatory handling for unknown and high-impact activity, and redacted, size-bounded journal
  entries and list responses stored in SQLite.

## Hardening priorities

These items should be completed before Workbench presents installation as a polished one-click
product:

1. Publish versioned release artifacts with provenance, checksums, and platform signing where the
   platform supports it.
2. Replace terminal-only progress with a permission-transparent setup experience that still shows
   provider, channel, service, and host-access decisions.
3. Add a true channel round trip and Gateway exposure analysis. The shipped model request, channel
   snapshot, and Guardrails runtime check do not cover those boundaries.
4. Establish and publish a private reporting path for Workbench-only vulnerabilities.
5. Add tested update, backup, restore, rollback, and uninstall controls to the Workbench page.
6. Capture repeatable visual and accessibility proof for the Workbench page on supported viewport
   sizes and themes.

Until the signed-artifact item is complete, documentation must describe Workbench as a source
distribution and must not label current ZIP downloads or scripts as signed installers.

## Product increments

- Upstream-sync status that identifies the imported OpenClaw commit and any Workbench delta.
- A first-run sample workflow that exercises a model call, a durable Task, review, and a visible
  completion result.
- Recovery guidance that connects failed setup checks to `doctor`, backup, and platform-specific
  service diagnostics.

## Acceptance rules

A roadmap item moves to available only when:

- The operator-visible path exists in the checked-in product.
- Documentation states prerequisites, permissions, limits, and recovery behavior.
- The path ends with a visible result or an actionable failure.
- Relevant tests cover both success and a realistic failure boundary.
- Security claims describe the actual boundary and avoid words such as "safe" or "secure" without
  a named threat model.
- Install and update claims are verified from a clean machine or equivalent isolated environment.
- Upstream compatibility is checked against the exact imported revision.

## Direction

Workbench should remain a focused extension of OpenClaw. Existing OpenClaw owners keep their
responsibilities: the Gateway owns connections and runtime state, plugins own optional policy,
Tasks own durable work, and Workboard owns its orchestration surface. Workbench should make those
owners legible rather than duplicating them behind a second control plane.

Related: [OpenClaw Workbench](/workbench/index) and its
[support and security scope](/workbench/index#support-and-security-scope).
