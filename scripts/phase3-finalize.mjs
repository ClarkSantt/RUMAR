import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  'com.rumo.validation.phase3',
);
const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true })
    .click();
const tab = (name) =>
  page
    .getByRole('navigation', { name: 'Seções de treinos' })
    .getByRole('button', { name, exact: true })
    .click();
const sql = (query) =>
  page.evaluate(
    (query) =>
      window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
        db: 'sqlite:rumo.db',
        query,
        values: [],
      }),
    query,
  );
await nav('Treinos');
if (await page.getByRole('button', { name: '← Voltar aos treinos' }).isVisible())
  await page.getByRole('button', { name: '← Voltar aos treinos' }).click();
await tab('Plano');
if (!(await sql('SELECT archived_at FROM workout_plans'))[0].archived_at) {
  await page.getByRole('button', { name: 'Arquivar plano', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Arquivar plano?' })
    .getByRole('button', { name: 'Arquivar plano', exact: true })
    .click();
}
await page.getByRole('checkbox', { name: 'Mostrar planos arquivados' }).check();
await page.getByText('Plano arquivado · somente leitura').waitFor();
assert.equal(await page.getByRole('button', { name: 'Editar plano' }).isDisabled(), true);
assert.equal((await sql('SELECT active,archived_at FROM workout_plans'))[0].active, 0);
assert.equal(
  (await sql("SELECT count(*) n FROM workout_sessions WHERE status='completed'"))[0].n,
  2,
);
if (!(await sql("SELECT id FROM thoughts WHERE title='Validação de encerramento'"))[0]) {
  await nav('Pensamentos');
  await page.getByRole('button', { name: 'Novo pensamento' }).click();
  await page.getByLabel('Título (opcional)').fill('Validação de encerramento');
  await page
    .getByLabel('Pensamento', { exact: true })
    .fill('Rascunho persistido após treino. '.repeat(120));
  await page.getByRole('status').filter({ hasText: 'Salvo' }).first().waitFor();
}
await nav('Treinos');
await tab('Histórico');
await page.locator('.workout-history-row').first().click();
await page.getByLabel('Observações do treino').fill('Notas preservadas no perfil isolado.');
await page.getByLabel('Observações do treino').press('Tab');
await page.getByText('Salvo', { exact: true }).first().waitFor();
const load = page
  .getByRole('region', { name: 'Supino reto' })
  .getByRole('textbox', { name: 'Série 1: carga' });
await load.focus();
await page.keyboard.press('Tab');
assert.equal(
  await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  'Série 1: repetições',
);
await writeFile(
  'artifacts/phase3/finalize-report.json',
  JSON.stringify(
    {
      archivedPlanReadOnly: true,
      completedSessionsPreserved: true,
      thoughtSaved: true,
      notesSaved: true,
      keyboardLoadToReps: true,
    },
    null,
    2,
  ),
);
console.log('ARCHIVE_NOTES_THOUGHT_KEYBOARD_OK');
await browser.close();
