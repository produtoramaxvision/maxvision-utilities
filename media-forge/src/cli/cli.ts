import { Command } from 'commander';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerImageCommands } from './commands/image.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('media-forge')
    .version('0.1.0')
    .description('Production-grade image + video generation via top-tier Google AI models');

  registerDoctorCommand(program);
  registerImageCommands(program);
  // 9.3-9.4 will register more here

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'media-forge', ...argv]);
}
