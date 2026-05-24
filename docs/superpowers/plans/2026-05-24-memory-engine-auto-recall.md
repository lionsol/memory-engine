# Memory Engine Auto Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox () syntax for tracking.

**Goal:** Add explicit opt-in autoRecall that injects top-3 hybrid memory results before prompt build.

**Architecture:** Extract the current search implementation into a reusable  helper. The  search action and  hook call the same helper. Small pure helpers handle skip/force decisions and prompt formatting.

**Tech Stack:** OpenClaw plugin SDK, Node ESM, node:test, SQLite, LanceDB.

---

### Task 1: Pure Auto Recall Rules

**Files:**
- Modify: 
- Create: 

- [ ] Write failing node:test coverage for skip, force, and formatting helpers.
- [ ] Export helper functions under  from .
- [ ] Implement , , and .
- [ ] Run  in .

### Task 2: Shared Hybrid Search

**Files:**
- Modify: 

- [ ] Extract the existing  body into .
- [ ] Replace the tool search branch with a call to .
- [ ] Run  and .

### Task 3: before_prompt_build Hook

**Files:**
- Modify: 
- Modify: 

- [ ] Add explicit  config schema with , , and .
- [ ] Register  when enabled.
- [ ] The hook skips trivial prompts, calls , formats results, and returns .
- [ ] Run ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
██░▄▄▄░██░▄▄░██░▄▄▄██░▀██░██░▄▄▀██░████░▄▄▀██░███░██
██░███░██░▀▀░██░▄▄▄██░█░█░██░█████░████░▀▀░██░█░█░██
██░▀▀▀░██░█████░▀▀▀██░██▄░██░▀▀▄██░▀▀░█░██░██▄▀▄▀▄██
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
                       OPENCLAW                       
 
┌  OpenClaw doctor
│
◇  Config warnings ───────────────────────────────────────────────────────╮
│                                                                         │
│  - plugins.entries.lossless-claw: plugin disabled (disabled in config)  │
│    but config is present                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
◇  Doctor warnings ────────────────────────────────────────────────────────╮
│                                                                          │
│  - Personal Codex CLI assets were found, but native Codex-mode OpenClaw  │
│    agents use isolated per-agent Codex homes.                            │
│  - Sources: /home/lionsol/.codex and /home/lionsol/.agents/skills (2     │
│    skills, 0 plugins, 0 config files, 0 hook files).                     │
│  - These assets will not be loaded by the Codex app-server child unless  │
│    you intentionally promote them.                                       │
│  - Run │
│  Migration preview: codex
│  Source: /home/lionsol/.codex
│  Target: /home/lionsol/.openclaw/workspace
│  2 items, 0 conflicts, 0 sensitive items
│
│  Skills:
│  • characteristic-voice (Copy Codex skill into OpenClaw)
│  • tts (Copy Codex skill into OpenClaw)
│
│  Warnings:
│  ⚠️  Codex app-server plugin inventory discovery failed: Codex marketplace openai-curated was not found in source plugin inventory.. Cached plugin bundles, if any, are advisory only. to inventory them. Applying    │
│    that migration copies skills into the current OpenClaw agent          │
│    workspace; Codex plugins, hooks, and config stay manual-review only.  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  State integrity ────────────────────────────────────────────────────────╮
│                                                                          │
│  - Found 5 orphan transcript files in ~/.openclaw/agents/main/sessions.  │
│    These .jsonl files are no longer referenced by sessions.json, so      │
│    they are not part of any active session history.                      │
│    Doctor can archive them safely by renaming each file to               │
│    *.deleted.<timestamp>.                                                │
│    Examples: 2639efa5-585d-402c-bcb7-cf8f3ae23e83.jsonl,                 │
│    42b16ca6-433e-4940-92cf-e5e25c13a70b.jsonl,                           │
│    521f02ea-c4c8-4e04-baa5-f004a3816713.jsonl, and 2 more                │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Doctor warnings ───────────────────────────────────────────────────────╮
│                                                                         │
│  - Legacy  session route state detected.                │
│  - Affected sessions: 1.                                                │
│  - Run ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
██░▄▄▄░██░▄▄░██░▄▄▄██░▀██░██░▄▄▀██░████░▄▄▀██░███░██
██░███░██░▀▀░██░▄▄▄██░█░█░██░█████░████░▀▀░██░█░█░██
██░▀▀▀░██░█████░▀▀▀██░██▄░██░▀▀▄██░▀▀░█░██░██▄▀▄▀▄██
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
                       OPENCLAW                       
 
┌  OpenClaw doctor
│
◇  Config warnings ───────────────────────────────────────────────────────╮
│                                                                         │
│  - plugins.entries.lossless-claw: plugin disabled (disabled in config)  │
│    but config is present                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
◇  Plugin registry ───────────────────────────────────────────╮
│                                                             │
│  Plugin registry refreshed: 71/94 enabled plugins indexed.  │
│                                                             │
├─────────────────────────────────────────────────────────────╯
│
◇  State integrity ────────────────────────────────────────────────────────╮
│                                                                          │
│  - Found 5 orphan transcript files in ~/.openclaw/agents/main/sessions.  │
│    These .jsonl files are no longer referenced by sessions.json, so      │
│    they are not part of any active session history.                      │
│    Doctor can archive them safely by renaming each file to               │
│    *.deleted.<timestamp>.                                                │
│    Examples: 2639efa5-585d-402c-bcb7-cf8f3ae23e83.jsonl,                 │
│    42b16ca6-433e-4940-92cf-e5e25c13a70b.jsonl,                           │
│    521f02ea-c4c8-4e04-baa5-f004a3816713.jsonl, and 2 more                │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Doctor changes ───────────────────────────────────────────────────╮
│                                                                    │
│  Repaired Codex session routes: moved 1 session across 1 store to  │
│  openai/* while preserving auth-profile pins.                      │
│                                                                    │
├────────────────────────────────────────────────────────────────────╯
│
◇  Cron ───────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Cron model overrides detected at ~/.openclaw/cron/jobs.json.            │
│  - 3 jobs set `payload.model` and will not inherit                       │
│    `agents.defaults.model` (deepseek/deepseek-v4-flash)                  │
│  - Provider namespaces: deepseek=3                                       │
│  Review with openclaw cron list and openclaw cron show <job-id>; remove  │
│  `payload.model` from jobs that should inherit the default.              │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Gateway service config ───────────────────────────────────────────────╮
│                                                                        │
│  - Gateway service embeds proxy environment values that should not be  │
│    persisted. (inline keys: HTTPS_PROXY, HTTP_PROXY)                   │
│  - Gateway service PATH missing required dirs:                         │
│    /home/lionsol/.local/share/pnpm                                     │
│                                                                        │
├────────────────────────────────────────────────────────────────────────╯
│
◇  Gateway service config ──────────────────────────────────────────────╮
│                                                                       │
│  Run `openclaw gateway install --force` when you want to replace the  │
│  gateway service definition.                                          │
│                                                                       │
├───────────────────────────────────────────────────────────────────────╯
│
◇  Security ───────────────────────────────────────────────────────────────╮
│                                                                          │
│  - Heartbeat defaults: heartbeat delivery is configured while            │
│    agents.defaults.heartbeat.directPolicy is unset.                      │
│    Heartbeat now allows direct/DM targets by default. Set it explicitly  │
│    to "allow" or "block" to pin upgrade behavior.                        │
│  - WARNING: Gateway bound to "lan" (0.0.0.0) (network-accessible).       │
│    Ensure your auth credentials are strong and not exposed.              │
│    Safer remote access: keep bind loopback and use Tailscale             │
│    Serve/Funnel or an SSH tunnel.                                        │
│    Example tunnel: ssh -N -L 18789:127.0.0.1:18789 user@gateway-host     │
│    Docs: https://docs.openclaw.ai/gateway/remote                         │
│  - Run: openclaw security audit --deep                                   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Skills status ───────────╮
│                           │
│  Eligible: 29             │
│  Missing requirements: 0  │
│  Blocked by allowlist: 0  │
│                           │
├───────────────────────────╯
│
◇  Plugins ──────╮
│                │
│  Loaded: 71    │
│  Imported: 0   │
│  Disabled: 23  │
│  Errors: 0     │
│                │
├────────────────╯
│
└  Doctor complete. to rewrite stale session model/provider  │
│    pins across all agent session stores.                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
◇  Cron ───────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Cron model overrides detected at ~/.openclaw/cron/jobs.json.            │
│  - 3 jobs set  and will not inherit                       │
│     (deepseek/deepseek-v4-flash)                  │
│  - Provider namespaces: deepseek=3                                       │
│  Review with openclaw cron list and openclaw cron show <job-id>; remove  │
│   from jobs that should inherit the default.              │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Gateway service config ───────────────────────────────────────────────╮
│                                                                        │
│  - Gateway service embeds proxy environment values that should not be  │
│    persisted. (inline keys: HTTPS_PROXY, HTTP_PROXY)                   │
│  - Gateway service PATH missing required dirs:                         │
│    /home/lionsol/.local/share/pnpm                                     │
│                                                                        │
├────────────────────────────────────────────────────────────────────────╯
│
◇  Gateway service config ──────────────────────────────────────────────╮
│                                                                       │
│  Run │
◇  Config warnings ───────────────────────────────────────────────────────╮
│                                                                         │
│  - plugins.entries.lossless-claw: plugin disabled (disabled in config)  │
│    but config is present                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯

Installed systemd service: /home/lionsol/.config/systemd/user/openclaw-gateway.service
Previous unit backed up to: /home/lionsol/.config/systemd/user/openclaw-gateway.service.bak when you want to replace the  │
│  gateway service definition.                                          │
│                                                                       │
├───────────────────────────────────────────────────────────────────────╯
│
◇  Security ───────────────────────────────────────────────────────────────╮
│                                                                          │
│  - Heartbeat defaults: heartbeat delivery is configured while            │
│    agents.defaults.heartbeat.directPolicy is unset.                      │
│    Heartbeat now allows direct/DM targets by default. Set it explicitly  │
│    to "allow" or "block" to pin upgrade behavior.                        │
│  - WARNING: Gateway bound to "lan" (0.0.0.0) (network-accessible).       │
│    Ensure your auth credentials are strong and not exposed.              │
│    Safer remote access: keep bind loopback and use Tailscale             │
│    Serve/Funnel or an SSH tunnel.                                        │
│    Example tunnel: ssh -N -L 18789:127.0.0.1:18789 user@gateway-host     │
│    Docs: https://docs.openclaw.ai/gateway/remote                         │
│  - Run: openclaw security audit --deep                                   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
◇  Skills status ───────────╮
│                           │
│  Eligible: 29             │
│  Missing requirements: 0  │
│  Blocked by allowlist: 0  │
│                           │
├───────────────────────────╯
│
◇  Plugins ──────╮
│                │
│  Loaded: 71    │
│  Imported: 0   │
│  Disabled: 23  │
│  Errors: 0     │
│                │
├────────────────╯
│
◇  Gateway ───────────────────────────────────────────────────────────────╮
│                                                                         │
│  Runtime: running (pid 108478, state active, sub running, last exit 0,  │
│  reason 0)                                                              │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
Run "openclaw doctor --fix" to apply changes.
│
└  Doctor complete. and confirm plugin errors remain 0.
