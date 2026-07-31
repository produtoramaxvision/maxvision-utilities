// src/cli/commands/setup.ts
// T16 — guided setup for optional, user-installed providers.
//
// This command GUIDES. It never installs, never downloads, and never modifies
// the machine. That is the constraint on T16, and it is the reason the whole
// thing is a report plus instructions rather than an installer: Wan2GP means
// 30-80 GB of model weights, and a tool that starts that download because
// someone typed a setup command is a tool that has spent an evening of the
// user's bandwidth without asking.
//
// The order matters. Requirements are checked and printed BEFORE the install
// instructions, so a machine that cannot run it finds out before the download,
// not after.

import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import type { Command } from 'commander';
import {
  checkWan2gpRequirements,
  wan2gpBaseUrl,
  isWan2gpEnabled,
  WAN2GP_MIN_VRAM_GB,
  WAN2GP_MIN_DISK_GB,
  WAN2GP_MAX_DISK_GB,
} from '../../video/providers/wan2gp.js';

/**
 * Best-effort VRAM probe via nvidia-smi.
 *
 * Returns null on anything unexpected rather than guessing. Null means "did not
 * detect", which the requirement check reports differently from "not enough" —
 * telling someone their GPU is too small when the probe merely failed sends them
 * to replace hardware that was fine.
 *
 * AMD and Apple Silicon are not probed; they report null and the user is asked
 * to verify. Claiming to support a probe that does not exist would be worse.
 */
export function probeVramGb(): number | null {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    const first = out.split('\n')[0]?.trim();
    if (first === undefined || first.length === 0) return null;
    const mib = Number.parseInt(first, 10);
    if (!Number.isFinite(mib) || mib <= 0) return null;
    return Math.round((mib / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

/** Best-effort free-disk probe. Null on failure, never a guess. */
export function probeFreeDiskGb(path: string): number | null {
  try {
    const stats = statfsSync(path);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes <= 0) return null;
    return Math.round((freeBytes / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command('setup')
    .description('Guided setup for optional, self-hosted providers (never installs anything)');

  setup
    .command('wan2gp')
    .description('Check whether this machine can run Wan2GP, and how to install it yourself')
    .action(() => {
      const vramGb = probeVramGb();
      const freeDiskGb = probeFreeDiskGb(process.cwd());
      const check = checkWan2gpRequirements({ vramGb, freeDiskGb });

      const lines: string[] = [];

      lines.push('Wan2GP — self-hosted video generation');
      lines.push('');
      lines.push('media-forge does NOT install Wan2GP, download its weights, or start its');
      lines.push('server. You install and run it; the plugin only talks to it. This command');
      lines.push('reports whether your machine meets the requirements so you can decide');
      lines.push('BEFORE downloading tens of gigabytes.');
      lines.push('');

      lines.push('Requirements');
      lines.push(`  VRAM   at least ${WAN2GP_MIN_VRAM_GB} GB`);
      lines.push(`  Disk   ${WAN2GP_MIN_DISK_GB}-${WAN2GP_MAX_DISK_GB} GB for model weights`);
      lines.push('');

      lines.push('This machine');
      lines.push(`  VRAM   ${vramGb === null ? 'not detected' : `${vramGb} GB`}`);
      lines.push(`  Disk   ${freeDiskGb === null ? 'not detected' : `${freeDiskGb} GB free`}`);
      lines.push('');

      if (check.warnings.length > 0) {
        lines.push('Warnings');
        for (const warning of check.warnings) {
          lines.push(`  ! ${warning}`);
        }
        lines.push('');
      } else {
        lines.push('This machine meets the published minimums.');
        lines.push('');
      }

      lines.push('If you choose to proceed');
      lines.push('  1. Install Wan2GP yourself, following its own documentation.');
      lines.push('  2. Start its Gradio server.');
      lines.push('  3. Point media-forge at it and enable the provider:');
      lines.push('       MEDIA_FORGE_WAN2GP_ENABLED=true');
      lines.push(`       MEDIA_FORGE_WAN2GP_URL=${wan2gpBaseUrl()}   (default shown)`);
      lines.push('');
      lines.push('Routing note');
      lines.push('  Wan2GP prices at $0 because local inference has no per-generation');
      lines.push('  charge. It is therefore EXCLUDED from automatic cost-based routing —');
      lines.push('  otherwise $0 would win every route and silently replace Veo and Kling');
      lines.push('  for all work. Select it explicitly with preferProvider when you want it.');
      lines.push('');

      lines.push(
        `Current state: MEDIA_FORGE_WAN2GP_ENABLED is ${isWan2gpEnabled() ? 'true' : 'not set'}.`,
      );

      // Written to stdout rather than the logger: this is a report the user
      // asked for, not a diagnostic event.
      process.stdout.write(`${lines.join('\n')}\n`);
    });
}
