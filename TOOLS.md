# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

### Desktop Control (Windows)

- **Skill:** `desktop-control-win` at `~/.openclaw/workspace/skills/desktop-control-win/`
- **Scripts:** `scripts/*.ps1` (PowerShell scripts)
- **Usage from WSL2:** `powershell.exe -ExecutionPolicy Bypass -File "$HOME/.openclaw/workspace/skills/desktop-control-win/scripts/<script>.ps1" -Action <action> [params]`
- **Note:** From WSL2, call `powershell.exe` (not `powershell`), use WSL path as is

### Tailscale

- **desktop-j85o4um** → `100.102.115.103` (WSL2 主机)
- **14xpro** → `100.73.47.52` (Sol 的 14 寸笔记本)

## Safe Delete Strategy

- **WSL2 (Ubuntu):** `trash-put` 可用（trash-cli 已安装）
- **Windows 宿主机：** 通过 `powershell.exe` 调用 `[Microsoft.VisualBasic.FileIO]::DeleteFile()` 或 `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile()`

## Related

- [Agent workspace](/concepts/agent-workspace)
