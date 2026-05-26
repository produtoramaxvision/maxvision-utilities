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

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('media-forge')
    .version('0.1.0')
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
