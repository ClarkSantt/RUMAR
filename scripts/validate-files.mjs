import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const extensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.rs',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((path) => extensions.has(extname(path)) || path === '.gitignore');
const problems = [];
for (const path of files) {
  const contents = readFileSync(path, 'utf8');
  if (contents.includes('\0')) problems.push(`${path}: NUL em arquivo de texto`);
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (/[\t ]+$/.test(line)) problems.push(`${path}:${index + 1}: whitespace no fim da linha`);
    if (/^(<<<<<<< |=======|>>>>>>> )/.test(line))
      problems.push(`${path}:${index + 1}: marcador de conflito`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${files.length} arquivos de texto rastreados/não rastreados verificados.`);
}
