#!/usr/bin/env node
/**
 * Builds a browsable gallery of the Marketing Studio assets on the signed-in
 * account — avatars, hooks, settings, ad-formats, ad-references, products.
 *
 *   node scripts/build-marketing-studio-gallery.mjs [outFile]
 *
 * Every call is a `list`, which is a READ. Spends 0 credits.
 *
 * WHY THIS IS A LOCAL FILE AND NOT A HOSTED PAGE
 *
 * The previews live on cdn.higgsfield.ai. Anything published under a strict CSP
 * (a Claude Artifact, for one) blocks that host and renders every tile broken,
 * which looks exactly like "the assets are gone". Opened from disk there is no
 * such restriction and the images load.
 *
 * These assets are HIGGSFIELD'S, on your account — presets the platform ships,
 * not files this repo produced. The gallery exists so a name like "Jayden" or a
 * uuid stops being the only thing you can see about them.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BIN = process.env['MEDIA_FORGE_HF_BIN'] ?? 'higgsfield';
const OUT = resolve(process.argv[2] ?? 'marketing-studio-gallery.html');

const KINDS = [
  'avatars',
  'hooks',
  'settings',
  'ad-formats',
  'ad-references',
  'products',
  'brand-kits',
];

function list(kind) {
  try {
    const stdout = execFileSync(BIN, ['marketing-studio', kind, 'list', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch (err) {
    // A group that errors is reported as such rather than silently rendering
    // empty — "0 avatars" and "could not ask" are different facts.
    return { error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The preview field is not named the same thing across groups. */
function previewOf(row) {
  for (const key of ['preview_url', 'thumbnail_url', 'image_url', 'video_url', 'url', 'logo']) {
    const v = row[key];
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  return undefined;
}

function nameOf(row) {
  for (const key of ['name', 'display_name', 'title', 'brand_name']) {
    const v = row[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '(sem nome)';
}

function card(row) {
  const preview = previewOf(row);
  const isVideo = preview?.endsWith('.mp4');
  const media = preview
    ? isVideo
      ? `<video src="${esc(preview)}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>`
      : `<img src="${esc(preview)}" alt="${esc(nameOf(row))}" loading="lazy">`
    : `<div class="noprev">sem preview</div>`;
  const meta = [row['gender'], row['type'], row['category'], row['group']]
    .filter((v) => typeof v === 'string' && v.length > 0)
    .join(' · ');
  return `<figure class="card">
  ${media}
  <figcaption>
    <b>${esc(nameOf(row))}</b>
    ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
    <code>${esc(row['id'] ?? '')}</code>
  </figcaption>
</figure>`;
}

const sections = KINDS.map((kind) => {
  const rows = list(kind);
  if (!Array.isArray(rows)) {
    return `<section><h2>${kind} <span class="count">erro</span></h2>
      <p class="err">${esc(rows.error)}</p></section>`;
  }
  const withPreview = rows.filter((r) => previewOf(r) !== undefined).length;
  return `<section>
  <h2>${kind} <span class="count">${rows.length} ${
    rows.length === withPreview ? '' : `· ${withPreview} com preview`
  }</span></h2>
  ${rows.length === 0 ? '<p class="empty">nada nesta conta</p>' : `<div class="grid">${rows.map(card).join('\n')}</div>`}
</section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marketing Studio — assets da conta</title>
<style>
  :root { color-scheme: dark; --bg:#000; --surface:#0a0a0a; --border:#1f1f1f;
          --text:#fafafa; --muted:#9e9e9e; --brand:#A93636; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--text);
         font:15px/1.5 Inter, system-ui, sans-serif; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  .sub { color:var(--muted); margin:0 0 2.5rem; max-width:62ch; }
  .sub b { color:var(--text); }
  h2 { font-size:1.05rem; margin:2.5rem 0 1rem; text-transform:uppercase;
       letter-spacing:.08em; border-bottom:2px solid var(--brand);
       padding-bottom:.4rem; display:flex; gap:.6rem; align-items:baseline; }
  .count { font-size:.8rem; color:var(--muted); letter-spacing:0; text-transform:none; }
  .grid { display:grid; gap:1rem;
          grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); }
  .card { margin:0; background:var(--surface); border:1px solid var(--border);
          border-radius:10px; overflow:hidden; }
  .card img, .card video { width:100%; aspect-ratio:3/4; object-fit:cover; display:block;
                           background:#111; }
  .noprev { aspect-ratio:3/4; display:grid; place-items:center; color:var(--muted);
            font-size:.8rem; background:#111; }
  figcaption { padding:.6rem .7rem; display:flex; flex-direction:column; gap:.2rem; }
  figcaption b { font-size:.9rem; }
  .meta { font-size:.75rem; color:var(--muted); }
  figcaption code { font-size:.65rem; color:#666; word-break:break-all; }
  .empty, .err { color:var(--muted); font-style:italic; }
  .err { color:#e57373; font-style:normal; }
</style></head><body>
<h1>Marketing Studio — assets da conta</h1>
<p class="sub">Presets que a <b>Higgsfield</b> disponibiliza na conta
<code>produtoramaxvision@gmail.com</code> — não são arquivos criados por este
repositório. Gerado por <code>scripts/build-marketing-studio-gallery.mjs</code>,
só com chamadas <code>list</code>: <b>0 créditos</b>.
Os ids abaixo são o que <code>media_higgsfield_marketing_studio</code> e
<code>media_higgsfield_dtc_ad</code> recebem.</p>
${sections}
</body></html>
`;

writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT}`);
