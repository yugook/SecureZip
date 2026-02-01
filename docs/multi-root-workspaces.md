# Multi-Root Workspace Targeting

This document defines how SecureZip resolves export targets and
`.securezipignore` rules in VS Code multi-root workspaces.

## Goals

- Make target selection predictable and easy to explain.
- Keep `.securezipignore` behavior isolated per workspace folder.
- Preserve single-root behavior.

## Terms

- Workspace folder: A folder entry in a VS Code multi-root workspace.
- Git-managed workspace: VS Code Git extension has one or more repositories.
- VS Code default target: The folder selected by VS Code state (Git selection
  when available, otherwise active editor).
- Target root: The folder that defines export scope for a single ZIP.

## `.securezipignore` resolution

- Resolve from each target root.
- Only apply patterns to files under that target root.
- Priority per folder: `.securezipignore` > `.gitignore` > auto-excludes.
- No cross-folder lookup or shared ignore file.
- If `.securezipignore` is missing, treat as "no extra ignores".

## Export modes

1. VS Code default (automatic target selection).
2. Workspace ZIP (export all workspace folders into a single archive).

Workspace ZIP layout:
- Each workspace folder is placed under a top-level directory named after the
  workspace folder.
- `.securezipignore` priority is applied per folder.

## VS Code default target selection

### Git-managed workspace

- Follow VS Code Git selection state. SecureZip does not add a separate
  "auto/fixed" toggle.
- Target root is the selected repository root.
- SCM single selection mode: export the selected repository.
- SCM multiple selection mode:
  - If exactly one repository is selected, export that repository.
  - If multiple repositories are selected, require an explicit choice at export:
    - Workspace ZIP, or
    - Select a single repository.
- If the Git extension is unavailable, fall back to the non-Git workflow.

Notes:
- If multiple repositories live under a single workspace folder, the repository
  root is still used as the target root for Git-managed exports.

### No Git-managed workspace

- Target root is the workspace folder resolved from the active editor.
- If there is no active editor or it is outside the workspace, use the first
  workspace folder in workspace order.
- If no workspace folder exists, prompt the user to select a folder.

## UX requirements

- Show the current target in the status bar (Auto / fixed folder / Workspace).
- Export command prompts with:
  - VS Code default, or
  - Workspace ZIP.
- If VS Code default is ambiguous (multiple selections), prompt for explicit
  target selection.
- SecureZip view aligns with SCM multiple-repository behavior:
  - When multiple Git repositories are present, display repo-level groups.
  - Each group contains its own Guide / Actions / Preview / Recent sections.
- Explorer context menu execution uses the clicked file/folder as the target
  for that invocation.

## Edge cases

- If a target resolves outside the workspace (for example via symlink), treat it
  as out-of-scope and show an error or prompt.
- If workspace folder names collide, disambiguate the ZIP top-level directories
  by appending a numeric suffix such as `-2`, `-3`.
