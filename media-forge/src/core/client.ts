import { GoogleGenAI } from '@google/genai';
import type { MediaForgeConfig } from './config.js';
import { ConfigError } from './errors.js';

export type ClientMode = 'gemini' | 'vertex';

export interface MediaForgeClient {
  readonly mode: ClientMode;
  readonly dryRun: boolean;
  readonly ai: GoogleGenAI;
}

export interface CreateClientOpts {
  config: MediaForgeConfig;
  dryRun?: boolean;
  /** Test injection point — do NOT use in production code. */
  _GoogleGenAIClass?: new (init: unknown) => GoogleGenAI;
}

/** Dry-run proxy: intercepts SDK calls and returns stable mock responses. */
function buildDryRunProxy(ai: GoogleGenAI): GoogleGenAI {
  return new Proxy(ai, {
    get(target, prop) {
      if (prop === 'models') {
        return new Proxy(target.models, {
          get(_t, method) {
            if (method === 'generateContent') {
              return async (req: unknown) => ({
                candidates: [],
                generatedImages: [],
                operationName: 'dry-run-op',
                dryRunPayload: req,
              });
            }
            if (method === 'generateImages') {
              return async (req: unknown) => ({
                generatedImages: [],
                operationName: 'dry-run-op',
                dryRunPayload: req,
              });
            }
            if (method === 'generateVideos') {
              return async (req: unknown) => ({
                candidates: [],
                operationName: 'dry-run-op',
                dryRunPayload: req,
              });
            }
            return ((_t as unknown) as Record<string | symbol, unknown>)[method];
          },
        });
      }
      if (prop === 'operations') {
        return new Proxy(target.operations, {
          get(_t, method) {
            if (method === 'getVideosOperation') {
              return async (req: unknown) => ({
                done: true,
                operationName: 'dry-run-op',
                dryRunPayload: req,
              });
            }
            return ((_t as unknown) as Record<string | symbol, unknown>)[method];
          },
        });
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  });
}

export function createClient(opts: CreateClientOpts): MediaForgeClient {
  const { config, dryRun = false } = opts;
  const Ctor = opts._GoogleGenAIClass ?? GoogleGenAI;

  // SE4: `mode` is pure config inspection — compute it eagerly (no creds needed,
  // never throws). The actual GoogleGenAI construction (which REQUIRES creds and
  // throws ConfigError when absent) is deferred to the first `.ai` access. This
  // keeps `buildServer()` / the MCP handshake working without GOOGLE_API_KEY — only
  // a tool call that actually needs the SDK fails, instead of the whole session.
  const mode: ClientMode = config.useVertex && config.project ? 'vertex' : 'gemini';

  let cachedAi: GoogleGenAI | undefined;
  function buildAi(): GoogleGenAI {
    let ai: GoogleGenAI;
    if (config.useVertex && config.project) {
      ai = new Ctor({ vertexai: true, project: config.project, location: config.location });
    } else if (config.apiKey) {
      ai = new Ctor({ apiKey: config.apiKey });
    } else if (dryRun) {
      // Dry-run with no creds: instantiate a stub client. The proxy below intercepts
      // every SDK call before it can hit the network, so a placeholder apiKey is safe.
      ai = new Ctor({ apiKey: 'dry-run-stub' });
    } else {
      throw new ConfigError(
        'No Google credentials configured: set GOOGLE_API_KEY or GOOGLE_PROJECT_ID+GOOGLE_LOCATION',
      );
    }
    return dryRun ? buildDryRunProxy(ai) : ai;
  }

  return Object.freeze({
    mode,
    dryRun,
    get ai(): GoogleGenAI {
      return (cachedAi ??= buildAi());
    },
  });
}
