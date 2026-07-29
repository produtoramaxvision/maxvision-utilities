// Guards media-forge/skills/**/*.md against prompt-injection and other hostile
// content sneaking in through a third-party skill sync (e.g. czlonkowski/n8n-skills
// style vendoring, or the Emily2040/seedance-2.0 absorption this test was written
// for). A skill is text the model OBEYS: everything under skills/ loads into the
// agent's context as instructions, so this file re-runs on every future upstream
// sync and fails closed on anything that looks like it wants to hijack the host
// agent rather than just direct a creative-domain workflow.
//
// Scope: only media-forge SHIPS (skills/**/*.md), never the upstream packed
// repomix output used during the one-time audit -- that file does not exist on
// other machines or in CI.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dir, '..', 'skills');

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function findMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      out.push(full);
    }
  }
  return out;
}

const markdownFiles = findMarkdownFiles(skillsDir);

interface ScannedFile {
  relPath: string;
  content: string;
}

const files: ScannedFile[] = markdownFiles.map((absPath) => ({
  relPath: absPath.slice(skillsDir.length + 1).replace(/\\/g, '/'),
  content: readFileSync(absPath, 'utf-8'),
}));

// ---------------------------------------------------------------------------
// 1. Invisible / bidirectional unicode
// ---------------------------------------------------------------------------

const INVISIBLE_CODEPOINTS: Record<number, string> = {
  0xfeff: 'BOM (U+FEFF)',
  0x200b: 'zero-width space (U+200B)',
  0x200c: 'zero-width non-joiner (U+200C)',
  0x200d: 'zero-width joiner (U+200D)',
  0x200e: 'left-to-right mark (U+200E)',
  0x200f: 'right-to-left mark (U+200F)',
  0x202a: 'LRE (U+202A)',
  0x202b: 'RLE (U+202B)',
  0x202c: 'PDF (U+202C)',
  0x202d: 'LRO (U+202D)',
  0x202e: 'RLO (U+202E)',
  0x2066: 'LRI (U+2066)',
  0x2067: 'RLI (U+2067)',
  0x2068: 'FSI (U+2068)',
  0x2069: 'PDI (U+2069)',
};

function findInvisibleUnicode(content: string): string[] {
  const hits: string[] = [];
  for (const ch of content) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const known = INVISIBLE_CODEPOINTS[cp];
    if (known) {
      hits.push(known);
      continue;
    }
    // Unicode Tags block (supplementary plane) -- used in real-world jailbreaks
    // to smuggle instructions invisibly inside otherwise normal-looking text.
    if (cp >= 0xe0000 && cp <= 0xe007f) {
      hits.push(`unicode tag character (U+${cp.toString(16).toUpperCase()})`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 2. Credential-shaped tokens and env-var reads
// ---------------------------------------------------------------------------
//
// Deliberately narrow: skill prose routinely mentions "API key", "token", or
// "secret" as ordinary setup vocabulary (see skills/setup/SKILL.md). Flagging
// the *word* would make this test noisy and false-positive against our own
// first-party skills. Instead this flags vendor-shaped secret literals and
// actual programmatic env-var reads embedded in the markdown.
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/, // AWS temporary access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style secret key
  /\bgh[pousr]_[A-Za-z0-9]{36}\b/, // GitHub token variants
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /\bsk_live_[A-Za-z0-9]{16,}\b/, // Stripe live secret key
  /\bpk_live_[A-Za-z0-9]{16,}\b/, // Stripe live publishable key (still a leak signal in prose)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT literal
  /process\.env(\.\w+|\[)/, // programmatic env read, not a bare env-var name
  /os\.environ(\.get\(|\[|\.get\s*\()/, // Python env read
  /os\.getenv\(/,
];

// ---------------------------------------------------------------------------
// 3. "Ignore previous instructions" style overrides
// ---------------------------------------------------------------------------
//
// Targets the actual hijack phrasing, not creative-domain uses of "override"
// (e.g. "accepted footage overrides planned state" is normal continuity
// language in this corpus and must not trip this check).
const OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|the\s+above)\s+instructions?/i,
  /disregard\s+(all\s+|any\s+)?(previous|prior|the\s+above)\s+instructions?/i,
  /forget\s+(everything|all\s+(previous|prior)\s+instructions?|your\s+instructions)/i,
  /\bDAN\b[^\n]{0,20}\bmode\b/i,
  /jailbreak/i,
  /you\s+are\s+now\s+(in\s+)?(developer|debug|unrestricted|admin)\s+mode/i,
  /act\s+as\s+an?\s+(unrestricted|unfiltered|uncensored)\b/i,
  /reveal\s+(your|the)\s+system\s+prompt/i,
  /new\s+system\s+prompt/i,
];

// ---------------------------------------------------------------------------
// 4. Exfiltration shapes
// ---------------------------------------------------------------------------

const EXFIL_PATTERNS: RegExp[] = [
  /curl\s+[^\n]*-X\s*POST/i,
  /\bsend\b[^\n]{0,40}\bto\b[^\n]{0,10}https?:\/\//i,
  /\bupload\b[^\n]{0,40}\bto\b[^\n]{0,10}https?:\/\//i,
  /\b(POST|PUT)\s+https?:\/\//,
  /\bwebhook\b[^\n]{0,30}https?:\/\//i,
];

// ---------------------------------------------------------------------------
// 5. URL allowlist
// ---------------------------------------------------------------------------
//
// Hosts below were individually classified during the Emily2040/seedance-2.0
// absorption audit (2026-07-29) as legitimate documentation citations, agent-
// packaging references, or schema identifiers -- never as runtime fetch
// targets embedded in an instruction. Extend this list only after the same
// classification exercise on the new host; do not bulk-approve a sync.
const ALLOWED_HOSTS = new Set<string>([
  // Repo / packaging metadata
  'github.com',
  'json-schema.org',
  // Seedance / ByteDance official
  'seed.bytedance.com',
  'www.volcengine.com',
  'developer.volcengine.com',
  'docs.byteplus.com',
  'jimeng.jianying.com',
  // Model card / research
  'arxiv.org',
  'openaccess.thecvf.com',
  // Third-party inference providers (surface documentation, not fetched at runtime)
  'fal.ai',
  'docs.dev.runwayml.com',
  'help.runwayml.com',
  'runwayml.com',
  'replicate.com',
  'evolink.ai',
  'openrouter.ai',
  'kie.ai',
  'piapi.ai',
  'docs.laozhang.ai',
  'runware.ai',
  'modelslab.com',
  'docs.aimlapi.com',
  'muapi.ai',
  'seegen.ai',
  'www.segmind.com',
  'docs.comfy.org',
  // News / reporting cited for the copyright-suspension timeline
  'variety.com',
  'www.cnbc.com',
  // Agent-skills ecosystem docs (agent-compatibility.md source list)
  'developers.openai.com',
  'openai.com',
  'agentskills.io',
  'antigravity.google',
  'codelabs.developers.google.com',
  'docs.openclaw.ai',
  'hermes-agent.nousresearch.com',
  'docs.trae.ai',
  'qwenlm.github.io',
  'opencode.ai',
  'cursor.com',
  'ampcode.com',
  'block.github.io',
  'junie.jetbrains.com',
  // Professional film/broadcast/delivery standards (source-registry.md)
  'theasc.com',
  'www.studiobinder.com',
  'www.screenskills.com',
  'docs.acescentral.com',
  'www.dcimovies.com',
  'registry-page.isdcf.com',
  'partnerhelp.netflixstudios.com',
  'w3c.github.io',
  'www.law.cornell.edu',
  'www.itu.int',
  'tech.ebu.ch',
  'www.atsc.org',
  'www.smpte.org',
  'www.thedpp.com',
  'movielabs.com',
]);

const URL_PATTERN = /https?:\/\/[^\s)\]"'>,;`]+/g;

function findDisallowedUrls(content: string): string[] {
  const hits: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const raw = match[0];
    let hostname: string;
    try {
      hostname = new URL(raw).hostname.toLowerCase();
    } catch {
      hits.push(`unparseable URL: ${raw}`);
      continue;
    }
    if (!ALLOWED_HOSTS.has(hostname)) {
      hits.push(`${raw} (host "${hostname}" not in allowlist)`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skills markdown -- prompt-injection scan', () => {
  it('discovers at least the 14 first-party skills currently shipped', () => {
    // Guards the glob/walk itself: a typo here would make every other check in
    // this file vacuously pass against zero files.
    expect(markdownFiles.length).toBeGreaterThanOrEqual(14);
  });

  it('contains no invisible or bidirectional unicode control characters', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const hit of findInvisibleUnicode(file.content)) {
        violations.push(`${file.relPath}: ${hit}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains no credential-shaped tokens or programmatic env-var reads', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const pattern of CREDENTIAL_PATTERNS) {
        const match = file.content.match(pattern);
        if (match) {
          violations.push(`${file.relPath}: matched ${pattern} ("${match[0]}")`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains no "ignore previous instructions" style override phrasing', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const pattern of OVERRIDE_PATTERNS) {
        const match = file.content.match(pattern);
        if (match) {
          violations.push(`${file.relPath}: matched ${pattern} ("${match[0]}")`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains no exfiltration shapes (POST/curl/send-to/upload-to a URL)', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const pattern of EXFIL_PATTERNS) {
        const match = file.content.match(pattern);
        if (match) {
          violations.push(`${file.relPath}: matched ${pattern} ("${match[0]}")`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains no http(s) URLs outside the reviewed allowlist', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const hit of findDisallowedUrls(file.content)) {
        violations.push(`${file.relPath}: ${hit}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
