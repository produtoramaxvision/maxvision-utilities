// src/refs/audit-gallery.ts
// Reads trace.jsonl for a job, finds the refs_selection record, downloads each
// ref + the moodboard (if any), generates 256px thumbnails via sharp, and writes
// a self-contained index.html for visual debug + brand review handoff.
//
// ECQ3: per-ref download failures are caught individually — the gallery always
// succeeds even when MinIO is unreachable. Offline refs render as placeholder
// divs in the HTML output. thumbCount counts only successfully downloaded thumbs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { MinioClient } from './minio-client.js';

interface RefsSelectionRecord {
  type: 'refs_selection';
  refMode: string;
  seedUsed: number;
  refsChosen: Array<{ category: string; objectKey: string; rank?: number }>;
}

export interface AuditGalleryOptions {
  tracePath: string;
  outputDir: string;
  client: MinioClient;
  moodboardPath?: string;
}

export interface AuditGalleryResult {
  htmlPath: string;
  thumbCount: number;
}

export async function generateAuditGallery(opts: AuditGalleryOptions): Promise<AuditGalleryResult> {
  const lines = (await readFile(opts.tracePath, 'utf8')).trim().split('\n');
  const refsRecord = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .find((r): r is RefsSelectionRecord => r?.type === 'refs_selection');
  if (!refsRecord) {
    throw new Error(`No refs_selection record in ${opts.tracePath}`);
  }

  const thumbsDir = resolve(opts.outputDir, 'refs-thumbs');
  await mkdir(thumbsDir, { recursive: true });

  // ECQ3: offline-safe thumb array
  const thumbs: Array<{ src: string | null; category: string; rank: number; offline: boolean }> = [];
  for (let i = 0; i < refsRecord.refsChosen.length; i++) {
    const ref = refsRecord.refsChosen[i]!;
    try {
      const raw = await opts.client.downloadObject(ref.objectKey);
      const thumb = await sharp(raw, { animated: false })
        .resize(256, 256, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toBuffer();
      const fname = `thumb-${i}.jpg`;
      await writeFile(resolve(thumbsDir, fname), thumb);
      thumbs.push({ src: `refs-thumbs/${fname}`, category: ref.category, rank: ref.rank ?? i, offline: false });
    } catch {
      // Offline / unreachable MinIO — degrade gracefully (ECQ3)
      thumbs.push({ src: null, category: ref.category, rank: ref.rank ?? i, offline: true });
    }
  }

  // Moodboard section — try/catch so a missing file doesn't break the gallery
  let moodboardImg = '';
  if (opts.moodboardPath) {
    try {
      const mb = await readFile(opts.moodboardPath);
      const small = await sharp(mb).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      await writeFile(resolve(opts.outputDir, 'moodboard.jpg'), small);
      moodboardImg = '<img src="moodboard.jpg" style="max-width:512px;border:2px solid #333">';
    } catch {
      // Moodboard not accessible — skip section silently
    }
  }

  const thumbCount = thumbs.filter((t) => !t.offline).length;

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>media-forge audit</title>` +
    `<style>body{font-family:system-ui;background:#111;color:#eee;padding:20px}` +
    `.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(256px,1fr));gap:12px}` +
    `.card{background:#222;padding:8px;border-radius:6px}` +
    `.card img{width:100%;display:block;border-radius:4px}` +
    `.cat{font-size:12px;color:#aaa;margin-top:4px}` +
    `.placeholder{color:#888;padding:80px 8px;text-align:center;font-style:italic}` +
    `</style></head><body>` +
    `<h1>media-forge audit</h1>` +
    `<p>Mode: <b>${refsRecord.refMode}</b> · seed: <code>${refsRecord.seedUsed}</code>` +
    ` · refs: ${thumbs.length} (${thumbCount} downloaded, ${thumbs.length - thumbCount} offline)</p>` +
    (moodboardImg ? `<h2>Moodboard</h2>${moodboardImg}` : '') +
    `<h2>Reference picks</h2><div class="grid">` +
    thumbs
      .map((t) =>
        t.offline
          ? `<div class="card offline"><div class="placeholder">[ref ${t.category} (offline)]</div><div class="cat">${t.category} · rank ${t.rank}</div></div>`
          : `<div class="card"><img src="${t.src}"><div class="cat">${t.category} · rank ${t.rank}</div></div>`,
      )
      .join('') +
    `</div></body></html>`;

  const htmlPath = resolve(opts.outputDir, 'audit-gallery.html');
  await writeFile(htmlPath, html);
  return { htmlPath, thumbCount };
}
