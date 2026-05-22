import type { Command } from 'commander';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
} from '../../core/models.js';

interface ModelInfo {
  id: string;
  type: 'image' | 'video';
  capabilities: string[];
}

export const LOCKED_MODEL_INFO: ModelInfo[] = [
  {
    id: IMAGE_MODEL_NANO_BANANA_PRO,
    type: 'image',
    capabilities: [
      'text-to-image',
      'reference-images (up to 14)',
      'Google Search grounding',
      'thinking levels (MINIMAL|LOW|MEDIUM|HIGH)',
      'aspect ratios: 1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9',
      'image sizes: 1K|2K|4K',
    ],
  },
  {
    id: IMAGE_MODEL_IMAGEN_4_ULTRA,
    type: 'image',
    capabilities: [
      'text-to-image',
      'seed support',
      'negative prompt',
      'aspect ratios: 1:1|3:4|4:3|9:16|16:9',
      'image sizes: 1K|2K',
    ],
  },
  {
    id: VIDEO_MODEL_VEO_3_1_PRO,
    type: 'video',
    capabilities: [
      't2v (text-to-video)',
      'i2v (image-to-video)',
      'frame interpolation',
      'reference images (up to 3)',
      'video extension (up to 20 hops)',
      'resolutions: 720p|1080p|4k',
      'durations: 4|6|8s',
      'audio generation',
    ],
  },
];

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description('List all locked model IDs with capability summary')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(LOCKED_MODEL_INFO, null, 2)}\n`);
        return;
      }
      process.stdout.write('Locked models (top-tier only)\n');
      process.stdout.write('-----------------------------\n');
      for (const m of LOCKED_MODEL_INFO) {
        process.stdout.write(`\n${m.id}  [${m.type}]\n`);
        for (const cap of m.capabilities) {
          process.stdout.write(`  - ${cap}\n`);
        }
      }
      process.stdout.write('\n');
    });
}
