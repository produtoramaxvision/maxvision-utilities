import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAuditGallery } from '../../../src/refs/audit-gallery.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';

// 1×1 transparent GIF — smallest valid image sharp can decode
const tinyGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const tracePayload = [
  JSON.stringify({
    type: 'refs_selection',
    refMode: 'MOODBOARD',
    seedUsed: 42,
    refsChosen: [
      { category: 'dolly-zoom', objectKey: 'dolly-zoom/x.gif', rank: 0 },
      { category: 'bullet-time', objectKey: 'bullet-time/y.gif', rank: 1 },
    ],
  }),
].join('\n');

function makeClient(overrides?: Partial<MinioClient>): MinioClient {
  return {
    listObjects: vi.fn(),
    headObject: vi.fn(),
    presignObject: vi.fn(),
    downloadObject: vi.fn(async () => tinyGif),
    ...overrides,
  } as unknown as MinioClient;
}

describe('generateAuditGallery', () => {
  it('success path: produces HTML + thumbnails from trace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-aud-'));
    const tracePath = join(dir, 'trace.jsonl');
    await writeFile(tracePath, tracePayload);

    const client = makeClient();
    const result = await generateAuditGallery({ tracePath, outputDir: dir, client });

    // thumbCount counts only successful downloads
    expect(result.thumbCount).toBe(2);

    const html = await readFile(result.htmlPath, 'utf8');
    // Category names present in HTML
    expect(html).toContain('dolly-zoom');
    expect(html).toContain('bullet-time');
    // Mode and seed present
    expect(html).toContain('MOODBOARD');
    expect(html).toContain('42');
    // CSS placeholder rule present even on success path
    expect(html).toContain('.placeholder');
  });

  it('ECQ3 offline path: gallery succeeds with all-offline thumbs when downloadObject throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-aud-offline-'));
    const tracePath = join(dir, 'trace.jsonl');
    await writeFile(tracePath, tracePayload);

    const client = makeClient({
      downloadObject: vi.fn(async () => {
        throw new Error('ECONNREFUSED: MinIO unreachable');
      }),
    });

    // Must not throw — ECQ3 guarantee
    const result = await generateAuditGallery({ tracePath, outputDir: dir, client });

    // No successful downloads
    expect(result.thumbCount).toBe(0);

    const html = await readFile(result.htmlPath, 'utf8');
    // Offline placeholders rendered for both refs
    expect(html).toContain('(offline)');
    expect(html).toContain('dolly-zoom');
    expect(html).toContain('bullet-time');
    // Placeholder CSS class present
    expect(html).toContain('class="placeholder"');
    // .placeholder CSS rule with correct styling
    expect(html).toContain('.placeholder');
    expect(html).toContain('color:#888');
    expect(html).toContain('text-align:center');
    expect(html).toContain('font-style:italic');
  });
});
