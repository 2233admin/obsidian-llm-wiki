---
llmwiki_type: analysis
status: analyzed
project_id: "freetoken-eval"
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
actor: "codex"
tags: ["freetoken-eval", "xr-3080", "hardware-survey", "inference-blocked"]
related_sources: ["src_freetoken_0ab982f10"]
related_issues: ["001-blocked-eval"]
---

# FreeToken on xr-3080 — Host Layout Capture

Captured 2026-08-23 from `xr-3080` (192.168.50.38, root, SSH key
`~/.ssh/id_ed25519`). This note freezes the host state at the moment the
first cold-start of FreeToken `ft serve` was evaluated. Anything below is
a fact observed on that host; later snapshots must supersede this file
with a new dated capture rather than rewriting history.

## 1. OS & Kernel

- `Linux XR-3080 7.1.6-1-cachyos #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`
- CachyOS based on Arch. Boot time on the current kernel: Thu 2026-08-20 15:14
- `nvidia-powerd.service` running (PID 670); holds `/dev/nvidia0` (the only
  dGPU on this host). `nvidia-smi` was observed to hang the SSH session on
  three consecutive attempts — the call never returned within the 5-minute
  session timeout, while a parallel `ls /proc/driver/nvidia/` succeeded.
  Symptom reproduces with a fresh shell and is consistent with a NVIDIA
  userspace-vs-kernel mutex deadlock rather than a transient NVML issue.

## 2. Block Devices (lsblk, 2026-08-23 10:11 UTC)

| Device | Size | Type | FSTYPE | Mount | Status |
|---|---|---|---|---|---|
| `nvme0n1p4` | 296 GiB | zhitai TI7100 | btrfs (`/`) | `/` | **98% full, 6.5 GiB free** |
| `nvme0n1p3` | 653 GiB | zhitai TI7100 | ntfs | `/mnt/xr-win10` (ro) | Win10 system disk, read-only |
| `nvme0n1p5` | 4.0 GiB | zhitai TI7100 | vfat | `/boot` | EFI, must not be written to |
| `nvme1n1` | 1.82 TiB | ZHITAI Ti600 | ntfs + recovery | `/mnt/xr-win11` (ro) on p3 | Win11 system disk, read-only |
| `nvme2n1` | **3.73 TiB** | aigo NVMe SSD P7000E | ntfs (label `DATA`) on p2 | **unmounted** | Win11 data store, 99% full (3.7 TiB used) and dirty / hibernation protected |
| `sda` | 57.3 GiB | Ultra USB 3.0 | exfat + vfat | unmounted | Ventoy installer key |
| `zram0` | 125.66 GiB | swap on tmpfs | swap | `[SWAP]` | 4.8 MiB used |

**No dedicated / provisioned disk exists for FreeToken runtime, model
weights, or HuggingFace cache on this host.** This is the single most
important fact for any future "why can't we just run it" question.

### 2.1 Detail: NVMe P7000E ("DATA")

- `/dev/nvme2n1p2`, NTFS, label `DATA`, UUID `E4D63B92AC596D55`, 3.7 TiB
  used out of 3.8 TiB; free space 43 GiB on `df` before mount.
- A write mount with `mount -t ntfs3 -o rw,...` was attempted on 2026-08-23
  to confirm compatibility. The mount returned
  `WARNING: source write-protected, mounted read-only`. Read-only root
  inspection showed:
  - Top-level entries: `AI-Models` (23 GiB), `BaiduNetdiskDownload` (1.4 TiB),
    `Blender Foundation`, `Catalog.wci`, `Clash Verge / *.7z`, `CloudMusic`,
    `EFI`, `Obsidian Vault`, `Program Files (x86)`, `ProgramData`,
    `Recovery`, `SteamLibrary`, `System Volume Information`, `UnrealProjects`,
    `WindowsApps`, `WeGameApps`, `ai`, `asst`, `work_S`, `工程`,
    `我的参考.library`, `$RECYCLE.BIN` (3.2 GiB), `pagefile.sys` (18 GiB),
    plus user files like `Profit Hunter @DaviddTech翻译Curry.{ini,txt}`.
  - **This volume is a working Win11 user's data store. It is not candidate
    for FreeToken runtime placement and never was.**
- The read-only mount was unmounted, and the empty `/tmp/_ro_check` mount
  point was removed. `/mnt/data` does not exist any more on the host.

### 2.2 Detail: tmpfs

`/tmp` is a 63 GiB tmpfs. It is large enough for the FreeToken runtime
(1.2 GiB) and a tiny test model, but anything mounted there is lost on
reboot. Do not use it for stable cache unless the design accepts that.

## 3. GPU

| Field | Value |
|---|---|
| Card | single NVIDIA RTX 3080 (Linux reports one `nvidia0` only) |
| Driver | NVIDIA proprietary (nvml via `/proc/driver/nvidia/` active) |
| Powerd | `nvidia-powerd.service` running (PID 670) holding `/dev/nvidia0` |
| `nvidia-smi` | **DEADLOCK observed 3×** (timed out > 300s). Session hung. |
| `--query-compute-apps` | Did not run (would also deadlock). |

Inference jobs that call into CUDA init while ollama / vLLM / `nvidia-powerd`
hold the nvml side will hang on the same mutex and the SSH session will
appear to freeze.

## 4. Active GPU / Inference Services

systemd running on 2026-08-23:

- `ollama.service` — active since 2026-08-20 22:51, Main PID 237881,
  Tasks 26, Memory 1.3 GiB. Spawned `llama-server` children:
  - `:234227` — port 58385, host 127.0.0.1, no webui
  - `:234268` — model `/var/lib/ollama/.ollama/models/blobs/sha256-1fe90b…`
  - `:237894` — port 65230, host 127.0.0.1, no webui
- `nvidia-powerd.service` — running
- docker containers running on host (overlayfs over the same btrfs `/`):
  - `6836a36a8b5a` — `vllm/vllm-openai:v0.22.0` (`/opt/joyai-*`)
  - `0ec3976db690` — `ghcr.io/2233admin/opencli-admin-api:0.4.1-node-progressive`
  - `d5f9eb9a5c86` — `ghcr.io/2233admin/opencli-admin-chrome:0.4.1-node-progressive`
  - `8ae6a0cfffa0` — `ghcr.io/2233admin/opencli-admin-frontend:0.4.1-node-local`

Image disk usage (relevant for relocation candidates): vllm-openai
containers together occupy ~62 GiB on disk in image layers.

## 5. FreeToken Runtime Install

- Path: `/opt/freetoken` (1.2 GiB pyvenv)
- Symlink: `/usr/local/bin/ft -> /opt/freetoken/bin/ft`
- pyvenv Python: `/root/.local/share/uv/python/cpython-3.12-linux-x86_64-gnu/bin/python`
- Version: `freetoken version 0.1.2+g0ab982f10`
- Companion binaries: `hf`, `huggingface-cli`, `modelscope`, `ms`,
  `gguf-*`, `tiny-agents`, `tvm-ffi-*`
- `ft serve --help` exits 0 with the full argument surface (see Source Note)
- No model weights and no HF cache were created during this inspection
  (`/root/.cache/huggingface` size = 76 KiB; `/var/lib/ollama` empty
  post-cleanup)

## 6. Pacman Cache Cleanup

On the day prior to this inspection a ~6 GiB pacman cache was removed and
the original vLLM environment dependencies were restored. This did not
touch model weights or container data. See the related `001-blocked-eval`
issue for the line-by-line acceptance criteria chain.

## 7. SSH Access

`~/.ssh/config` on the host machine:

```
Host xr-3080 xr3080
    HostName 192.168.50.38
    Port 22
    User root
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    PreferredAuthentications publickey
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Reachable from the workstation through the LAN (`192.168.50.53` ARP table
entry `d4-93-90-22-3e-88`). `BatchMode=yes` succeeds with `echo OK`.

## 8. Fact Sheet For Future Sessions

| Fact | Value |
|---|---|
| `df /` free | 6.5 GiB on btrfs |
| `df /mnt/xr-win10` free | 19 GiB (ro) |
| `df /mnt/xr-win11` free | 992 GiB (ro) |
| DATA volume (`nvme2n1p2`) free | 43 GiB (ro, 99% used) |
| `/boot` free | 3.5 GiB (EFI, must not write) |
| `/tmp` (tmpfs) free | 63 GiB (volatile) |
| ollama processes | PID 237881 + children 234227, 234268, 237894 |
| nvidia-powerd | PID 670 holding `/dev/nvidia0` |
| GPU mutex deadlock | `nvidia-smi` ≥ 300 s hang, reproducible 3× |
| FreeToken runtime size | 1.2 GiB at `/opt/freetoken` |
| FreeToken supported-model checkpoint on disk | none |

## 9. Research Questions Punted From This Capture

These are research-level questions that this note captures but does not
answer; see `01-Projects/freetoken-eval/issues/001-blocked-eval.md` for
the related Issue framing.

1. Which FreeToken-supported model family is the smallest weight checkpoint
   that will fit in 6.5 GiB residual on `/` while leaving kernel+packages
   headroom? Likely candidates require fresh spec reads from
   `https://github.com/FlashML-org/FreeToken/blob/main/docs/models.md`.
2. Is there an approach to bring nvml back online without rebooting
   xr-3080? E.g. SIGTERM/Cycle `nvidia-powerd.service`, check
   `/proc/driver/nvidia/version`, capture UVM state, then retry
   `nvidia-smi`. Such a sequence is not yet designed.
3. If ollama and the vllm containers are stopped, does the disk pressure
   (image layers + model weights they reference) fall enough to permit a
   shared tmpfs-temporary swap-in for FreeToken? This requires a snapshot
   of their image layers' on-disk sizes first.
4. If the workstation (192.168.50.53) has spare disk on its own NVMe,
   should we move FreeToken cold-start artifacts to a CIFS / sshfs mount
   of the workstation instead of consuming xr-3080 disk? Open question
   about cross-host mount cost vs. local NVMe.
