import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const OBJ_CUBE = `
v 0 0 0
v 10 0 0
v 10 8 0
v 0 8 0
v 0 0 6
v 10 0 6
v 10 8 6
v 0 8 6
g Fachada
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
g Cubierta
f 5 6 7 8
`;

test('flujo completo: ejemplo, capas, preparar y descargar STL', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Abre un modelo 3D de un edificio' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Cargar ejemplo' }).click();
  const layers = page.getByTestId('layers');
  await expect(layers.getByRole('listitem')).toHaveCount(6);
  await expect(page.getByTestId('model-size')).toContainText('64 × 44 × 36 mm');

  // La agrupación automática separa lo que no se ve desde fuera.
  await page.getByLabel('Agrupar piezas por').selectOption('exposicion');
  await expect(layers.getByRole('listitem')).toHaveCount(2);
  await page.getByLabel(/Mostrar Interior/).uncheck();

  // Seleccionar una capa y excluirla de la impresión.
  await page.getByLabel('Agrupar piezas por').selectOption('origen');
  await layers.getByRole('button', { name: 'Carpinteria' }).click();
  await expect(page.getByTestId('selection-count')).toContainText('2 piezas');
  await page.getByRole('button', { name: 'Excluir de la impresión' }).click();
  await expect(layers.getByText('Excluidos de la impresión')).toBeVisible();

  await page.getByRole('radio', { name: 'Cáscara hueca' }).click();
  await page.getByRole('button', { name: 'Preparar modelo' }).click();
  await expect(page.getByTestId('watertight')).toContainText('Malla cerrada', { timeout: 90_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar STL' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('edificio-ejemplo_1-200.stl');
  const stl = await readFile(await download.path());
  const triangles = stl.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(100);
  expect(stl.length).toBe(84 + triangles * 50);
});

test('abre un OBJ del usuario y respeta sus capas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'nave.obj',
    mimeType: 'text/plain',
    buffer: Buffer.from(OBJ_CUBE),
  });
  const layers = page.getByTestId('layers');
  await expect(layers.getByRole('button', { name: 'Fachada' })).toBeVisible();
  await expect(layers.getByRole('button', { name: 'Cubierta' })).toBeVisible();
  await expect(page.getByTestId('model-size')).toContainText('50 × 40 × 30 mm');
});

test('explica qué hacer con un fichero DGN', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'torre.dgn',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 1, 2, 3]),
  });
  await expect(page.getByRole('alert')).toContainText('Exportar');
});
