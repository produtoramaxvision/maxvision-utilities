import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadTemplate,
  loadAllTemplates,
  buildIndex,
  writeIndex,
  searchTemplates,
  tryTemplate,
} from '../../../src/prompts/template-loader.js';
import { ValidationError } from '../../../src/core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mf-loader-test-'));
}

function writeYaml(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const VALID_YAML = `
id: product/ecommerce-white-bg
domain: product
description: |
  Clean white-background product packshot suitable for e-commerce galleries.
  Use when the subject is a single physical product and the goal is catalog photography.
variables:
  - name: subject
    required: true
    description: The product description
  - name: angle
    required: false
    default: three-quarter view
template: |
  A studio packshot photograph of \${subject}, photographed at \${angle}.
  Lighting: soft diffused, with a seamless pure white (#FFFFFF) background.
  4K resolution, sharp focus, no shadows on background, photorealistic.
attribution: Derived from product photography conventions in research §6.1.
`;

const VALID_VIDEO_YAML = `
id: video-t2v/cinematic-establishing
domain: video-t2v
description: |
  Wide cinematic establishing shot for text-to-video generation.
  Use for scene-setting opening sequences with dramatic framing.
variables:
  - name: scene
    required: true
    description: The scene to render
template: |
  A wide cinematic establishing shot of \${scene}.
  Aspect ratio 16:9, duration 8 seconds, slow push-in camera movement.
  Photorealistic, cinematic lighting, high production value.
attribution: Derived from video production research §7.1.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadTemplate', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // 1. Happy path with valid YAML
  it('loads a valid template YAML successfully', async () => {
    const filePath = writeYaml(dir, 'ecommerce-white-bg.yml', VALID_YAML);
    const tpl = await loadTemplate(filePath);
    expect(tpl.id).toBe('product/ecommerce-white-bg');
    expect(tpl.domain).toBe('product');
    expect(tpl.variables).toHaveLength(2);
  });

  // 2. Malformed YAML throws ValidationError
  it('throws ValidationError for malformed YAML', async () => {
    const filePath = writeYaml(dir, 'bad.yml', 'id: : : malformed\n  bad indent:');
    await expect(loadTemplate(filePath)).rejects.toThrow(ValidationError);
  });

  // 3. Missing domain field → ValidationError
  it('throws ValidationError when domain field is missing', async () => {
    const yaml = `
id: product/test-item
description: A test item that is long enough to pass the min check.
template: |
  This is a template with enough content to pass validation checks.
  It has multiple lines and proper structure.
`;
    const filePath = writeYaml(dir, 'test.yml', yaml);
    await expect(loadTemplate(filePath)).rejects.toThrow(ValidationError);
  });

  // 4. Invalid domain enum → ValidationError
  it('throws ValidationError for invalid domain enum value', async () => {
    const yaml = `
id: unknown/test-item
domain: unknown-domain
description: |
  A test item description that is long enough to pass.
  Second line here.
template: |
  Template content here that is long enough.
  Second line to meet minimum length.
`;
    const filePath = writeYaml(dir, 'test.yml', yaml);
    await expect(loadTemplate(filePath)).rejects.toThrow(ValidationError);
  });

  // 5. id not matching domain/slug pattern → ValidationError
  it('throws ValidationError when id does not match domain/slug pattern', async () => {
    const yaml = `
id: InvalidID_with_uppercase
domain: product
description: |
  A test item description that is long enough.
  Second line here.
template: |
  Template content that is long enough.
  Second line here.
`;
    const filePath = writeYaml(dir, 'test.yml', yaml);
    await expect(loadTemplate(filePath)).rejects.toThrow(ValidationError);
  });

  // 5b. video-t2v domain id parses correctly (regression for digit-in-domain bug)
  it('accepts video-t2v domain id (digits in domain portion)', async () => {
    const filePath = writeYaml(dir, 'cinematic-establishing.yml', VALID_VIDEO_YAML);
    const tpl = await loadTemplate(filePath);
    expect(tpl.id).toBe('video-t2v/cinematic-establishing');
    expect(tpl.domain).toBe('video-t2v');
  });
});

describe('loadAllTemplates', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // 6. Empty dir → returns []
  it('returns empty array for empty prompts dir', async () => {
    const result = await loadAllTemplates(dir);
    expect(result).toEqual([]);
  });

  // 7. Walks subdirectories, skips _index.json and hidden files
  it('walks domain subdirs, skips _index.json and hidden files', async () => {
    const productDir = path.join(dir, 'product');
    fs.mkdirSync(productDir);
    writeYaml(productDir, 'ecommerce-white-bg.yml', VALID_YAML);
    writeYaml(productDir, '_index.json', '{}');
    writeYaml(productDir, '.hidden.yml', VALID_YAML.replace('product/ecommerce-white-bg', 'product/hidden'));

    const result = await loadAllTemplates(dir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('product/ecommerce-white-bg');
  });

  it('loads from multiple domain subdirectories', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);
    writeYaml(path.join(dir, 'video-t2v'), 'cinematic-establishing.yml', VALID_VIDEO_YAML);

    const result = await loadAllTemplates(dir);
    expect(result).toHaveLength(2);
    const ids = result.map((t) => t.id).sort();
    expect(ids).toContain('product/ecommerce-white-bg');
    expect(ids).toContain('video-t2v/cinematic-establishing');
  });
});

describe('buildIndex', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // 8. Produces correct shape (count, entries sorted by id)
  it('produces correct index shape with entries sorted by id', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);
    writeYaml(path.join(dir, 'video-t2v'), 'cinematic-establishing.yml', VALID_VIDEO_YAML);

    const index = await buildIndex(dir);
    expect(index.count).toBe(2);
    expect(index.entries).toHaveLength(2);
    expect(index.generatedAt).toBeTruthy();

    // sorted by id
    expect(index.entries[0]?.id).toBe('product/ecommerce-white-bg');
    expect(index.entries[1]?.id).toBe('video-t2v/cinematic-establishing');

    // IndexEntry shape
    const entry = index.entries[0]!;
    expect(entry.domain).toBe('product');
    expect(entry.path).toBe('prompts/product/ecommerce-white-bg.yml');
    expect(entry.variables).toBeDefined();
  });
});

describe('writeIndex', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // 9. Writes _index.json file
  it('writes _index.json atomically', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);

    const index = await writeIndex(dir);
    const outPath = path.join(dir, '_index.json');
    expect(fs.existsSync(outPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as {
      count: number;
      entries: unknown[];
      generatedAt: string;
    };
    expect(written.count).toBe(1);
    expect(written.entries).toHaveLength(1);
    expect(index.count).toBe(1);
  });
});

describe('searchTemplates', () => {
  it('returns empty array when index has no entries', () => {
    const index = { generatedAt: '', count: 0, entries: [] };
    expect(searchTemplates(index, 'portrait')).toEqual([]);
  });

  // 10. Exact match in id ranks higher than description match
  it('ranks id match higher than description-only match', () => {
    const index = {
      generatedAt: '',
      count: 2,
      entries: [
        {
          id: 'product/portrait-test',
          domain: 'product',
          path: 'prompts/product/portrait-test.yml',
          description: 'A generic product shot.',
          variables: [],
        },
        {
          id: 'character/generic-scene',
          domain: 'character',
          path: 'prompts/character/generic-scene.yml',
          description: 'A portrait of a character in a scene.',
          variables: [],
        },
      ],
    };
    const results = searchTemplates(index, 'portrait');
    expect(results[0]?.id).toBe('product/portrait-test'); // id match ranks first
  });

  it('returns all entries for empty query', () => {
    const index = {
      generatedAt: '',
      count: 1,
      entries: [
        {
          id: 'product/test',
          domain: 'product',
          path: 'prompts/product/test.yml',
          description: 'A test entry.',
          variables: [],
        },
      ],
    };
    expect(searchTemplates(index, '')).toHaveLength(1);
  });
});

describe('tryTemplate', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // 11. Missing required var → throws with missingRequired path
  it('throws ValidationError with missingRequired when required var absent', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);
    await expect(
      tryTemplate({ promptsDir: dir, id: 'product/ecommerce-white-bg', vars: {} }),
    ).rejects.toThrow(ValidationError);
  });

  it('renders successfully when required var is provided', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);
    const result = await tryTemplate({
      promptsDir: dir,
      id: 'product/ecommerce-white-bg',
      vars: { subject: 'a red ceramic mug' },
    });
    expect(result.rendered).toContain('a red ceramic mug');
    expect(result.templateId).toBe('product/ecommerce-white-bg');
    expect(result.missingRequired).toHaveLength(0);
  });

  it('dryRun mode returns missingRequired without throwing', async () => {
    writeYaml(path.join(dir, 'product'), 'ecommerce-white-bg.yml', VALID_YAML);
    const result = await tryTemplate({
      promptsDir: dir,
      id: 'product/ecommerce-white-bg',
      vars: {},
      dryRun: true,
    });
    expect(result.missingRequired).toContain('subject');
    // Does not throw
  });

  it('throws ValidationError for unknown template id', async () => {
    await expect(
      tryTemplate({ promptsDir: dir, id: 'product/nonexistent', vars: {} }),
    ).rejects.toThrow(ValidationError);
  });
});
