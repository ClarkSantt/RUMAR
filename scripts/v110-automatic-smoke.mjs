import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const phase = process.argv[2] ?? 'exercise';
assert(['exercise', 'verify'].includes(phase));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9227');
try {
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(20000);
  const invoke = (command, args = {}) =>
    page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
      command,
      args,
    });
  assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.v110');
  const info = await invoke('data_info');
  assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.v110\/rumo\.db$/);
  assert.doesNotMatch(info.databasePath, /com\.rumo\.desktop/i);
  const select = (query, values = []) =>
    invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values });
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  const plan = (await select("SELECT id FROM workout_plans WHERE name='A/B/C/Upper/Lower'"))[0];
  assert(plan, 'Execute v110-smoke seed primeiro');
  if (phase === 'exercise') {
    const unfinished = page.getByRole('dialog', { name: 'Adicionar exercício ao dia' });
    if (await unfinished.isVisible())
      await unfinished.getByRole('button', { name: 'Cancelar' }).click();
    await nav.getByRole('button', { name: 'Treinos' }).click();
    await page.getByRole('button', { name: 'Plano', exact: true }).click();
    for (const [name, weekday] of [
      ['A', 'Segunda'],
      ['B', 'Terça'],
      ['C', 'Quarta'],
      ['Lower', 'Sábado'],
    ]) {
      if (
        (
          await select('SELECT id FROM workout_days WHERE workout_plan_id=$1 AND name=$2', [
            plan.id,
            name,
          ])
        ).length
      )
        continue;
      await page.getByRole('button', { name: 'Adicionar dia' }).click();
      const dialog = page.getByRole('dialog', { name: 'Novo dia de treino' });
      await dialog.getByLabel('Nome do dia').fill(name);
      await dialog.getByRole('checkbox', { name: weekday }).check();
      await dialog.getByRole('button', { name: 'Salvar dia' }).click();
      await page
        .getByRole('navigation', { name: 'Dias do plano' })
        .getByRole('button', { name, exact: true })
        .waitFor();
    }
    await page
      .getByRole('navigation', { name: 'Dias do plano' })
      .getByRole('button', { name: 'Lower', exact: true })
      .click();
    if (
      !(await select("SELECT id FROM workout_day_exercises WHERE exercise_id='builtin-v110-001'"))
        .length
    ) {
      await page.getByRole('button', { name: 'Adicionar exercício', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Adicionar exercício ao dia' });
      await dialog
        .getByRole('searchbox', { name: 'Buscar na biblioteca' })
        .fill('supino reto com halteres');
      await dialog.getByLabel('Exercício', { exact: true }).selectOption('builtin-v110-001');
      await dialog.getByRole('button', { name: 'Salvar exercício no dia' }).click();
    }
    await page.getByText('Supino reto com halteres').first().waitFor();
    assert.equal(
      (
        await select('SELECT COUNT(*) AS n FROM workout_days WHERE workout_plan_id=$1', [plan.id])
      )[0].n,
      5,
    );
    assert.equal(
      (
        await select('SELECT COUNT(*) AS n FROM workout_day_exercises WHERE exercise_id=$1', [
          'builtin-v110-001',
        ])
      )[0].n,
      1,
    );
    await page.getByRole('button', { name: 'Exercícios', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Buscar exercício' }).fill('pulley corda');
    await page.getByRole('heading', { name: 'Tríceps corda na polia' }).waitFor();
    await page.getByRole('button', { name: 'Hoje', exact: true }).click();
    const lower = (
      await select("SELECT id FROM workout_days WHERE workout_plan_id=$1 AND name='Lower'", [
        plan.id,
      ])
    )[0];
    await page.getByLabel('Dia do plano ativo').selectOption(lower.id);
    await page.getByRole('button', { name: 'Iniciar escolhido' }).click();
    await page.getByRole('heading', { name: 'Lower' }).waitFor();
    await page.getByRole('textbox', { name: 'Série 1: carga' }).fill('20');
    await page.getByRole('textbox', { name: 'Série 1: repetições' }).fill('10');
    await page.getByRole('checkbox', { name: 'Série 1: concluída' }).check();
    await page.getByRole('button', { name: 'Finalizar treino' }).click();
    await page.getByText(/Gasto estimado:/).waitFor();
    const session = (
      await select(
        "SELECT id,status FROM workout_sessions WHERE day_name='Lower' ORDER BY started_at DESC LIMIT 1",
      )
    )[0];
    assert.equal(session.status, 'completed');
    assert.equal(
      (
        await select(
          'SELECT COUNT(*) AS n FROM workout_sets WHERE workout_session_id=$1 AND completed=1',
          [session.id],
        )
      )[0].n,
      1,
    );
    console.log(
      JSON.stringify({
        phase,
        planDays: 5,
        newExercise: 'Supino reto com halteres',
        aliasSearch: 'pulley corda',
        completedSession: session.id,
      }),
    );
  } else {
    const days = await select(
      'SELECT name FROM workout_days WHERE workout_plan_id=$1 ORDER BY sort_order',
      [plan.id],
    );
    assert.deepEqual(
      days.map((row) => row.name),
      ['Upper', 'A', 'B', 'C', 'Lower'],
    );
    const session = (
      await select(
        "SELECT id,status FROM workout_sessions WHERE day_name='Lower' ORDER BY started_at DESC LIMIT 1",
      )
    )[0];
    assert.equal(session.status, 'completed');
    assert.equal(
      (
        await select(
          'SELECT COUNT(*) AS n FROM workout_sets WHERE workout_session_id=$1 AND completed=1',
          [session.id],
        )
      )[0].n,
      1,
    );
    console.log(JSON.stringify({ phase, planDays: days.length, completedSession: session.id }));
  }
} finally {
  await browser.close();
}
