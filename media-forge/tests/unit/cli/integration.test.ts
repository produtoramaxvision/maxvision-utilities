/**
 * Integration tests for CLI commands via CliExit sentinel (commit 9.5).
 *
 * Strategy: mock config/client/service layers; parse through commander via
 * buildProgram().parseAsync(); catch CliExit to assert exit code and payload
 * without hitting vitest's process.exit guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliExit } from '../../../src/cli/shared.js';

// ---------------------------------------------------------------------------
// Service mocks — must be declared before any dynamic import of the modules
// that import them.
// ---------------------------------------------------------------------------

const mockGenerateImageNanoBananaPro = vi.fn();
const mockGenerateImageImagen4Ultra = vi.fn();
const mockEditImage = vi.fn();
const mockComposeScene = vi.fn();
const mockDescribeImage = vi.fn();
const mockExtractPalette = vi.fn();

vi.mock('../../../src/image/image-service.js', () => ({
  generateImageNanoBananaPro: mockGenerateImageNanoBananaPro,
  generateImageImagen4Ultra: mockGenerateImageImagen4Ultra,
  editImage: mockEditImage,
  composeScene: mockComposeScene,
  describeImage: mockDescribeImage,
  extractPalette: mockExtractPalette,
}));

const mockGenerateVideoT2V = vi.fn();
const mockGenerateVideoI2V = vi.fn();
const mockGenerateVideoInterpolate = vi.fn();
const mockGenerateVideoWithRefs = vi.fn();
const mockExtendVideo = vi.fn();
const mockPollVideoOperation = vi.fn();
const mockDownloadVideo = vi.fn();

vi.mock('../../../src/video/video-service.js', () => ({
  generateVideoT2V: mockGenerateVideoT2V,
  generateVideoI2V: mockGenerateVideoI2V,
  generateVideoInterpolate: mockGenerateVideoInterpolate,
  generateVideoWithRefs: mockGenerateVideoWithRefs,
  extendVideo: mockExtendVideo,
  pollVideoOperation: mockPollVideoOperation,
  downloadVideo: mockDownloadVideo,
}));

const FAKE_CONFIG = {
  apiKey: 'test-key',
  useVertex: false,
  project: undefined,
  location: 'us-central1',
  outputDir: './outputs',
  projectDir: '.media-forge',
  logLevel: 'info' as const,
  logFormat: 'pretty' as const,
  dryRun: false,
  pollIntervalMs: 10000,
  pollMaxAttempts: 90,
  runLiveTests: false,
  runEvals: false,
  dailyCapUsd: 10,
  confirmThresholdUsd: 1,
  blockThresholdUsd: 5,
  retryBudgetMultiplier: 1.5,
  showRetryBudget: false,
  ocrBackend: 'cloud-vision' as const,
  ocrGoogleVisionKey: undefined,
  reviewThreshold: 0.7,
  maxFixAttempts: 3,
  skipOcrWhenNoTextIntent: false,
  region: undefined,
};

const mockLoadConfig = vi.fn().mockReturnValue(FAKE_CONFIG);
const mockCreateClient = vi.fn().mockReturnValue({ _tag: 'fake-client' });

vi.mock('../../../src/core/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../../../src/core/client.js', () => ({
  createClient: mockCreateClient,
}));

// ---------------------------------------------------------------------------
// Helper — run a CLI argv through buildProgram and capture CliExit
// ---------------------------------------------------------------------------

async function runCli(argv: string[]): Promise<CliExit> {
  const { buildProgram } = await import('../../../src/cli/cli.js');
  const program = buildProgram();
  // exitOverride makes commander throw CommanderError instead of calling
  // process.exit for --help / --version. CliExit is our own sentinel.
  program.exitOverride();
  try {
    await program.parseAsync(['node', 'media-forge', ...argv]);
    // If no CliExit was thrown the command finished without exitOk/exitErr —
    // treat as exit 0 with no payload (shouldn't happen in normal flow).
    return new CliExit(0);
  } catch (err) {
    if (err instanceof CliExit) return err;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue(FAKE_CONFIG);
  mockCreateClient.mockReturnValue({ _tag: 'fake-client' });
});

// ---------------------------------------------------------------------------
// image generate — wires through to generateImageNanoBananaPro
// ---------------------------------------------------------------------------

describe('CLI integration — image generate', () => {
  it('calls generateImageNanoBananaPro with parsed prompt and exits 0', async () => {
    const fakeResult = { outputPath: '/tmp/img.png' };
    mockGenerateImageNanoBananaPro.mockResolvedValue(fakeResult);

    const exit = await runCli(['image', 'generate', 'a red fox']);

    expect(exit.code).toBe(0);
    expect(mockGenerateImageNanoBananaPro).toHaveBeenCalledOnce();
    const [input] = mockGenerateImageNanoBananaPro.mock.calls[0] as [{ prompt: string; op: string }, unknown];
    expect(input.prompt).toBe('a red fox');
    expect(input.op).toBe('nano-banana-pro');
  });

  it('--dry-run propagates dryRun=true to input and exits 0', async () => {
    mockGenerateImageNanoBananaPro.mockResolvedValue({ outputPath: '/tmp/img.png' });

    const exit = await runCli(['image', 'generate', 'sunny day', '--dry-run']);

    expect(exit.code).toBe(0);
    const [input] = mockGenerateImageNanoBananaPro.mock.calls[0] as [{ dryRun: boolean }, unknown];
    expect(input.dryRun).toBe(true);
  });

  it('service error → exits 1', async () => {
    mockGenerateImageNanoBananaPro.mockRejectedValue(new Error('quota exceeded'));

    const exit = await runCli(['image', 'generate', 'test prompt']);

    expect(exit.code).toBe(1);
  });

  it('--estimate-cost short-circuits before service call and exits 0', async () => {
    const exit = await runCli(['image', 'generate', 'test prompt', '--estimate-cost']);

    expect(exit.code).toBe(0);
    expect(mockGenerateImageNanoBananaPro).not.toHaveBeenCalled();
    expect(exit.payload).toMatchObject({ estimateUsd: expect.any(Number) });
  });
});

// ---------------------------------------------------------------------------
// image imagen — wires through to generateImageImagen4Ultra
// ---------------------------------------------------------------------------

describe('CLI integration — image imagen', () => {
  it('calls generateImageImagen4Ultra and exits 0', async () => {
    mockGenerateImageImagen4Ultra.mockResolvedValue({ outputPath: '/tmp/ultra.png' });

    const exit = await runCli(['image', 'imagen', 'sunset over ocean']);

    expect(exit.code).toBe(0);
    expect(mockGenerateImageImagen4Ultra).toHaveBeenCalledOnce();
    const [input] = mockGenerateImageImagen4Ultra.mock.calls[0] as [{ prompt: string; op: string }, unknown];
    expect(input.prompt).toBe('sunset over ocean');
    expect(input.op).toBe('imagen-4-ultra');
  });
});

// ---------------------------------------------------------------------------
// image edit — wires through to editImage
// ---------------------------------------------------------------------------

describe('CLI integration — image edit', () => {
  it('calls editImage with sourceImage + prompt and exits 0', async () => {
    mockEditImage.mockResolvedValue({ outputPath: '/tmp/edited.png' });

    const exit = await runCli(['image', 'edit', '/src/img.png', 'make it blue']);

    expect(exit.code).toBe(0);
    expect(mockEditImage).toHaveBeenCalledOnce();
    const [input] = mockEditImage.mock.calls[0] as [{ sourceImage: string; prompt: string }, unknown];
    expect(input.sourceImage).toBe('/src/img.png');
    expect(input.prompt).toBe('make it blue');
  });
});

// ---------------------------------------------------------------------------
// image compose — wires through to composeScene
// ---------------------------------------------------------------------------

describe('CLI integration — image compose', () => {
  it('calls composeScene and exits 0', async () => {
    mockComposeScene.mockResolvedValue({ outputPath: '/tmp/composed.png' });

    const exit = await runCli(['image', 'compose', 'product shot', '--ref', '/a.png', '--ref', '/b.png']);

    expect(exit.code).toBe(0);
    expect(mockComposeScene).toHaveBeenCalledOnce();
    const [input] = mockComposeScene.mock.calls[0] as [{ referenceImages: Array<{ path: string }> }, unknown];
    expect(input.referenceImages).toHaveLength(2);
    expect(input.referenceImages[0]?.path).toBe('/a.png');
  });
});

// ---------------------------------------------------------------------------
// image describe — wires through to describeImage
// ---------------------------------------------------------------------------

describe('CLI integration — image describe', () => {
  it('calls describeImage and exits 0', async () => {
    mockDescribeImage.mockResolvedValue({ description: 'A cat sitting on a mat.' });

    const exit = await runCli(['image', 'describe', '/path/to/image.jpg']);

    expect(exit.code).toBe(0);
    expect(mockDescribeImage).toHaveBeenCalledOnce();
    const [input] = mockDescribeImage.mock.calls[0] as [{ imagePath: string }, unknown];
    expect(input.imagePath).toBe('/path/to/image.jpg');
  });
});

// ---------------------------------------------------------------------------
// image palette — wires through to extractPalette (no client)
// ---------------------------------------------------------------------------

describe('CLI integration — image palette', () => {
  it('calls extractPalette without client and exits 0', async () => {
    mockExtractPalette.mockResolvedValue({ colors: ['#ff0000', '#00ff00'] });

    const exit = await runCli(['image', 'palette', '/path/to/photo.jpg']);

    expect(exit.code).toBe(0);
    expect(mockExtractPalette).toHaveBeenCalledOnce();
    // extractPalette takes only input, not a client
    expect(mockExtractPalette.mock.calls[0]).toHaveLength(1);
  });

  it('--estimate-cost returns 0 usd for local op and exits 0', async () => {
    const exit = await runCli(['image', 'palette', '/photo.jpg', '--estimate-cost']);

    expect(exit.code).toBe(0);
    expect(mockExtractPalette).not.toHaveBeenCalled();
    expect(exit.payload).toMatchObject({ estimateUsd: 0 });
  });
});

// ---------------------------------------------------------------------------
// video t2v — wires through to generateVideoT2V
// ---------------------------------------------------------------------------

describe('CLI integration — video t2v', () => {
  it('calls generateVideoT2V with parsed prompt and exits 0', async () => {
    mockGenerateVideoT2V.mockResolvedValue({ operationName: 'ops/123' });

    const exit = await runCli(['video', 't2v', 'ocean waves at sunset']);

    expect(exit.code).toBe(0);
    expect(mockGenerateVideoT2V).toHaveBeenCalledOnce();
    const [input] = mockGenerateVideoT2V.mock.calls[0] as [{ prompt: string; op: string }, unknown];
    expect(input.prompt).toBe('ocean waves at sunset');
    expect(input.op).toBe('t2v');
  });

  it('--estimate-cost short-circuits before service call and exits 0', async () => {
    const exit = await runCli(['video', 't2v', 'any prompt', '--estimate-cost']);

    expect(exit.code).toBe(0);
    expect(mockGenerateVideoT2V).not.toHaveBeenCalled();
    expect(exit.payload).toMatchObject({ estimateUsd: expect.any(Number) });
  });

  it('service error → exits 1', async () => {
    mockGenerateVideoT2V.mockRejectedValue(new Error('rate limit'));

    const exit = await runCli(['video', 't2v', 'test']);

    expect(exit.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// video i2v — wires through to generateVideoI2V
// ---------------------------------------------------------------------------

describe('CLI integration — video i2v', () => {
  it('calls generateVideoI2V with image path and exits 0', async () => {
    mockGenerateVideoI2V.mockResolvedValue({ operationName: 'ops/456' });

    const exit = await runCli(['video', 'i2v', 'animate this', '--image', '/frame.jpg']);

    expect(exit.code).toBe(0);
    const [input] = mockGenerateVideoI2V.mock.calls[0] as [{ firstFrameImage: string }, unknown];
    expect(input.firstFrameImage).toBe('/frame.jpg');
  });
});

// ---------------------------------------------------------------------------
// video extend — hop-index validation
// ---------------------------------------------------------------------------

describe('CLI integration — video extend', () => {
  it('calls extendVideo with valid hop-index and exits 0', async () => {
    mockExtendVideo.mockResolvedValue({ operationName: 'ops/789' });

    const exit = await runCli([
      'video', 'extend', 'continue the scene',
      '--source-uri', 'gs://bucket/video.mp4',
      '--hop-index', '5',
    ]);

    expect(exit.code).toBe(0);
    const [extendOpts] = mockExtendVideo.mock.calls[0] as [{ hopIndex: number; sourceVideoUri: string }];
    expect(extendOpts.hopIndex).toBe(5);
    expect(extendOpts.sourceVideoUri).toBe('gs://bucket/video.mp4');
  });

  it('hop-index > 19 → exits 1 with ValidationError', async () => {
    const exit = await runCli([
      'video', 'extend', 'continue',
      '--source-uri', 'gs://bucket/v.mp4',
      '--hop-index', '20',
    ]);

    expect(exit.code).toBe(1);
    expect(mockExtendVideo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// video poll — wires through to pollVideoOperation
// ---------------------------------------------------------------------------

describe('CLI integration — video poll', () => {
  it('calls pollVideoOperation with operationName and exits 0', async () => {
    mockPollVideoOperation.mockResolvedValue({ operation: { done: true } });

    const exit = await runCli(['video', 'poll', 'operations/projects/p/operations/abc123']);

    expect(exit.code).toBe(0);
    const [pollOpts] = mockPollVideoOperation.mock.calls[0] as [{ operationName: string }];
    expect(pollOpts.operationName).toBe('operations/projects/p/operations/abc123');
  });
});

// ---------------------------------------------------------------------------
// video download — wires through to downloadVideo
// ---------------------------------------------------------------------------

describe('CLI integration — video download', () => {
  it('calls downloadVideo with videoUri and exits 0', async () => {
    mockDownloadVideo.mockResolvedValue({ path: '/outputs/video.mp4' });

    const exit = await runCli(['video', 'download', 'gs://bucket/video.mp4']);

    expect(exit.code).toBe(0);
    const [dlOpts] = mockDownloadVideo.mock.calls[0] as [{ videoUri: string }];
    expect(dlOpts.videoUri).toBe('gs://bucket/video.mp4');
  });
});

// ---------------------------------------------------------------------------
// video wait — poll + download sequence
// ---------------------------------------------------------------------------

describe('CLI integration — video wait', () => {
  it('calls poll then download and exits 0', async () => {
    mockPollVideoOperation.mockResolvedValue({
      operation: {
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [{ video: { uri: 'gs://bucket/result.mp4' } }],
          },
        },
      },
    });
    mockDownloadVideo.mockResolvedValue({ path: '/outputs/video.mp4' });

    const exit = await runCli(['video', 'wait', 'operations/abc']);

    expect(exit.code).toBe(0);
    expect(mockPollVideoOperation).toHaveBeenCalledOnce();
    expect(mockDownloadVideo).toHaveBeenCalledOnce();
    const [dlOpts] = mockDownloadVideo.mock.calls[0] as [{ videoUri: string }];
    // URI extracted from poll response
    expect(dlOpts.videoUri).toBe('gs://bucket/result.mp4');
    // Payload contains both poll and download results
    expect(exit.payload).toMatchObject({ poll: expect.any(Object), download: expect.any(Object) });
  });

  it('fallback: uses operationName as videoUri when response has no URI', async () => {
    mockPollVideoOperation.mockResolvedValue({ operation: { done: true, response: {} } });
    mockDownloadVideo.mockResolvedValue({ path: '/outputs/video.mp4' });

    const exit = await runCli(['video', 'wait', 'operations/fallback-op']);

    expect(exit.code).toBe(0);
    const [dlOpts] = mockDownloadVideo.mock.calls[0] as [{ videoUri: string }];
    expect(dlOpts.videoUri).toBe('operations/fallback-op');
  });
});

// ---------------------------------------------------------------------------
// doctor — exits 0 when checks pass, exits 1 when config missing
// ---------------------------------------------------------------------------

describe('CLI integration — doctor', () => {
  it('exits 1 when no credentials in env', async () => {
    // Temporarily override loadConfig to throw ConfigError
    const { ConfigError } = await import('../../../src/core/errors.js');
    mockLoadConfig.mockImplementation(() => {
      throw new ConfigError('No credentials');
    });

    const exit = await runCli(['doctor', '--skip-network']);

    expect(exit.code).toBe(1);
  });
});
