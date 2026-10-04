import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The personal gateway runs with the exact Node runtime used to build the desktop.
// Only the executable is staged; credentials and local databases are never bundled.
if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 24)
  throw Error('A build Windows do gateway exige Node.js 24 ou superior.');
if (basename(process.execPath).toLowerCase() !== 'node.exe')
  throw Error('Não foi encontrado um executável Node.js Windows para empacotar.');
const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'resources',
  'finance-gateway',
);
mkdirSync(target, { recursive: true });
copyFileSync(process.execPath, join(target, 'node.exe'));
process.stdout.write('Runtime local do gateway preparado para o bundle.\n');
