// src/mcp/handlers.ts
// Registers all MCP tools backed by service implementations.
// Pattern: wrap each service call in wrap() for unified error handling and logging.
// NEVER throw from a handler — always return {isError: true} with message.
// F-C: registerAllTools receives optional tier and skips tools outside the tier gate.

export { setWebhookRouter, handleVideoWebhookStatus, _resetHiggsfieldProviderForTests } from './handlers/shared.js';
export type { VideoWebhookStatusResult } from './handlers/shared.js';

export {
  handleHiggsfieldPoll,
  handleHiggsfieldGenerate,
  handleHiggsfieldDownload,
  handleHiggsfieldDop,
  handleHiggsfieldCinemaStudio,
  handleHiggsfieldSpeak,
  handleHiggsfieldMarketingStudio,
  handleHiggsfieldRecast,
  handleHiggsfieldViralityPredictor,
  handleHiggsfieldSoulId,
} from './handlers/higgsfield.js';
export type { HiggsfieldHandlerExecOpts } from './handlers/higgsfield.js';

export { handleVideoCostEstimate, handleVideoCostReport, handleVideoRoute } from './handlers/video.js';
export type { VideoRouteResult } from './handlers/video.js';

export {
  handleKlingMotionBrush,
  handleKlingElementCreate,
  handleKlingElementList,
  handleKlingElementDelete,
  handleKlingElements,
  handleKlingLipSync,
  handleKlingOmniMultiShot,
  handleKlingVideoExtend,
  handleKlingPoll,
  handleKlingDownload,
} from './handlers/kling.js';
export type { KlingHandlerExecOpts } from './handlers/kling.js';

export {
  handleSeedanceTextToVideo,
  handleSeedanceImageToVideo,
  handleSeedanceMultishot,
  handleSeedanceReferenceFusion,
} from './handlers/seedance.js';
export type { SeedanceHandlerExecOpts } from './handlers/seedance.js';

export {
  withImageDebit,
  reserveVideoSubmit,
  captureVideoComplete,
  releaseVideoFailed,
  preflightVideoCredit,
} from './handlers/billing.js';
export type { HandlersDeps } from './handlers/billing.js';

export {
  handleNarrativePlan,
  handleNarrativeAssemble,
  NarrativePlanInput,
  NarrativeAssembleInput,
} from './handlers/narrative.js';
export type { NarrativeHandlerOpts } from './handlers/narrative.js';

export { registerAllTools } from './handlers/register.js';
