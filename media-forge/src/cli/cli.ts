import { Command } from 'commander';
import { CliExit } from './shared.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerImageCommands } from './commands/image.js';
import { registerVideoCommands } from './commands/video.js';
import { registerCostCommands } from './commands/cost.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerPromptsCommand } from './commands/prompts.js';
import { registerModelsCommand } from './commands/models.js';
import { registerConfigCommand } from './commands/config.js';
import { registerAliasesCommand } from './commands/aliases-suggest.js';
import { registerSetupCommands } from './commands/setup.js';
import { MEDIA_FORGE_VERSION } from '../index.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('media-forge')
    // Imported, not repeated. `media-forge --version` reported 0.1.1 through
    // four releases because this literal was its own source of truth.
    .version(MEDIA_FORGE_VERSION)
    .description('Production-grade image + video generation via top-tier Google AI models');

  registerDoctorCommand(program);
  registerImageCommands(program);
  registerVideoCommands(program);
  registerCostCommands(program);
  registerAuditCommand(program);
  registerPromptsCommand(program);
  registerModelsCommand(program);
  registerConfigCommand(program);
  registerAliasesCommand(program);
  registerSetupCommands(program);

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(['node', 'media-forge', ...argv]);
  } catch (err) {
    if (err instanceof CliExit) {
      process.exit(err.code);
    }
    throw err;
  }
}
