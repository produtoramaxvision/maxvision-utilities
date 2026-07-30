// src/narrative/agents/invoke.ts
// T13 — the shared invocation layer for the narrative planner's agents.
//
// ## Dual mode, matching the reviewer
//
// Follows the pattern already established by src/review/llm-judge.ts: inside a
// Claude Code session the agent returns a DIRECTIVE for the orchestrator to
// dispatch to a subagent (no API key needed, no extra billing); outside one it
// calls the Anthropic SDK directly. Introducing a second, different convention
// for the same problem would leave two things to keep in sync.
//
// ## Structured output rather than text parsing
//
// llm-judge.ts asks for JSON in the prompt and parses the reply. That works, but
// every parse is a chance to fail on a markdown fence or a trailing comma, and a
// failure here wastes a paid call.
//
// @anthropic-ai/sdk 0.98.0 -- the version actually installed, verified in
// node_modules rather than assumed from docs -- supports `output_config.format`
// with `jsonSchemaOutputFormat()`, which constrains generation to a schema at
// the API level. Used here.
//
// The schemas are hand-written JSON Schema rather than derived from the Zod
// schemas in this directory. The SDK's `zodOutputFormat()` requires `zod/v4`,
// while this repo is on zod 3.25 classic throughout. zod 3.25 does ship a
// `zod/v4` subpath, so mixing is possible -- but it would mean maintaining each
// narrative schema twice, in two dialects, and the two would drift. Instead the
// JSON Schema constrains the SHAPE at the API boundary and the existing Zod
// schemas validate the SEMANTICS after, including the cross-field invariants
// (disjoint beat lists, referential integrity) that JSON Schema cannot express
// at all. Two layers, each doing what it is good at, one source of truth for
// meaning.

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { logger } from '../../core/logger.js';
import { ApiError } from '../../core/errors.js';

/** Matches the reviewer's model choice; one place to change it for both. */
export const NARRATIVE_MODEL = 'claude-opus-4-7';

export type AgentMode = 'subagent' | 'sdk';

/**
 * Exactly what `jsonSchemaOutputFormat` accepts, derived from the installed
 * SDK's own signature rather than restated.
 *
 * Written as `Parameters<...>[0]` on purpose: the SDK types this with
 * `json-schema-to-ts`, which is a transitive dependency this package does not
 * declare. Importing `JSONSchema` from it directly would create an undeclared
 * dependency that breaks on a hoisting change; deriving it keeps the type exact
 * and the dependency graph honest. It also means a malformed agent schema fails
 * to compile rather than at the first paid call.
 */
export type ObjectJsonSchema = Parameters<typeof jsonSchemaOutputFormat>[0];

/** Every narrative agent the planner can dispatch. */
export const NARRATIVE_AGENTS = [
  'character-extractor',
  'screenwriter',
  'script-planner',
  'storyboard-artist',
  'reference-image-selector',
  'best-image-selector',
] as const;

export type NarrativeAgentName = (typeof NARRATIVE_AGENTS)[number];

/**
 * Returned instead of a result when running inside Claude Code. The orchestrator
 * dispatches it and feeds the reply back — the same contract JudgeDirective uses.
 */
export interface AgentDirective<TInput> {
  readonly mode: 'subagent';
  readonly agentName: `media-forge:${NarrativeAgentName}`;
  readonly payload: TInput;
}

export function isDirective<T>(value: unknown): value is AgentDirective<T> {
  return typeof value === 'object' && value !== null && (value as { mode?: string }).mode === 'subagent';
}

export interface InvokeAgentOpts {
  readonly forceMode?: AgentMode;
  readonly _anthropicClient?: Anthropic;
  readonly maxTokens?: number;
}

export interface InvokeAgentArgs<TInput> {
  readonly agent: NarrativeAgentName;
  readonly input: TInput;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** JSON Schema constraining the reply. Shape only; meaning is validated after. */
  readonly outputSchema: ObjectJsonSchema;
  readonly opts?: InvokeAgentOpts;
}

/**
 * Runs one narrative agent.
 *
 * Returns either the raw parsed object (SDK path) or a directive (subagent path).
 * The caller validates with the relevant Zod schema — this layer deliberately
 * does not, because each agent has a different result type and a different set
 * of cross-field rules.
 */
export async function invokeNarrativeAgent<TInput>(
  args: InvokeAgentArgs<TInput>,
): Promise<unknown | AgentDirective<TInput>> {
  const mode: AgentMode =
    args.opts?.forceMode ?? (process.env['CLAUDE_CODE_SESSION_ID'] ? 'subagent' : 'sdk');

  logger.debug('invokeNarrativeAgent: mode selected', { agent: args.agent, mode });

  if (mode === 'subagent') {
    return {
      mode: 'subagent',
      agentName: `media-forge:${args.agent}` as const,
      payload: args.input,
    } satisfies AgentDirective<TInput>;
  }

  const anthropic =
    args.opts?._anthropicClient ?? new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  const response = await anthropic.messages.parse({
    model: NARRATIVE_MODEL,
    max_tokens: args.opts?.maxTokens ?? 8000,
    system: args.systemPrompt,
    messages: [{ role: 'user', content: args.userPrompt }],
    output_config: { format: jsonSchemaOutputFormat(args.outputSchema) },
  });

  const parsed = (response as { parsed_output?: unknown }).parsed_output;
  if (parsed === undefined || parsed === null) {
    // With output_config.format set this should not happen; if it does, the
    // model returned something the API-level schema did not constrain, and
    // continuing would feed an unknown shape into the planner.
    throw new ApiError(
      `narrative agent "${args.agent}" returned no structured output despite an ` +
        `output_config schema being set`,
      'API',
      { agent: args.agent },
    );
  }

  return parsed;
}
