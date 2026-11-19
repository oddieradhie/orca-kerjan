# Kerjan for Orca

Integrates your Kerjan workspace directly into **Orca** with a right-sidebar panel, live status bar counter, interactive ticket updates, and one-click Git worktree creation.

## Features

- **My Tasks**: View, search, and filter tasks by status (`Active`, `WIP`, `To Do`, `Done`), and update task statuses (`Start`, `Done`, `Move to To Do`) directly from Orca.
- **Sprints**: Browse active, planned, and closed sprints with sprint goals, progress metrics, stories, and tasks.
- **Backlog**: Browse unscheduled backlog stories filtered by product.
- **Ticket Details & Comments**: Read full markdown descriptions, inspect story sub-tasks, and post comments without leaving Orca.
- **One-Click Git Worktree Creation**: Create and open a feature branch worktree (`feature/<ticket-key>-<slug>`) in any Git repository managed by Orca.
- **Secure Local Credentials**: Stores your API Key / MCP Token in Orca's OS-keyring encrypted secrets store (`secrets:own`) and automatically detects your Workspace and Member ID via `whoami` and `list_workspaces`.

## Installation

### From Orca Plugin Directory

Install via [orca.dev/plugins](https://orca.dev/plugins) or using the Orca CLI:

```sh
orca plugin install github:oddieradhie/orca-kerjan
```

## First-Time Setup

1. Open the **Kerjan** panel in Orca's right sidebar.
2. Enter your **Kerjan MCP URL** (for example `https://your-kerjan-host/api/v1/mcp`) and your **API Key / MCP Token** (`kjp_...`).
3. Click **Save & Connect**.
   - Orca verifies the connection via `whoami` and automatically detects your Workspace and Member ID.
   - Your API Key is saved encrypted via Orca's `secrets:own` store; click the **Settings** (gear) icon next to **Refresh** anytime to update your URL/token or disconnect.

## Development & Testing

```sh
orca plugin validate .
orca plugin test .
orca plugin check .
orca plugin dev watch .
```

## License

MIT
