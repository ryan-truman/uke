import { test, expect } from '@playwright/test';
import fs from 'fs';
import pdfParse from 'pdf-parse';

const mockSummary = {
  items: [
    { title: 'Dragon Ball - Dragonfruit honey, Colombia', variant: 'Espresso / 200g', quantity: 2 },
    { title: 'Chicharito - Washed Anaerobic, Mexico', variant: 'Filter / 250g', quantity: 1 },
  ],
  orders: [
    {
      number: '#1001',
      items: [
        { title: 'Dragon Ball - Dragonfruit honey, Colombia', variant: 'Espresso / 200g', quantity: 2 },
      ],
    },
    {
      number: '#1002',
      items: [
        { title: 'Chicharito - Washed Anaerobic, Mexico', variant: 'Filter / 250g', quantity: 1 },
      ],
    },
  ],
  orderCount: 2,
};

test('summary page matches screenshot', async ({ page }) => {
  await page.route('/api/orders', route => route.fulfill({ json: mockSummary }));

  await page.addInitScript(() => {
    localStorage.setItem('uke_shop', 'test.myshopify.com');
    localStorage.setItem('uke_client_id', 'test-client-id');
    localStorage.setItem('uke_client_secret', 'test-secret');
  });

  await page.goto('/');
  await expect(page.locator('#dl')).toBeVisible();

  await expect(page).toHaveScreenshot('summary.png', { maxDiffPixelRatio: 0.01 });
});

test('clear saved data button wipes credentials and resets the settings form', async ({ page }) => {
  await page.route('/api/orders', route => route.fulfill({ json: mockSummary }));

  await page.addInitScript(() => {
    localStorage.setItem('uke_shop', 'test.myshopify.com');
    localStorage.setItem('uke_client_id', 'test-client-id');
    localStorage.setItem('uke_client_secret', 'test-secret');
  });

  await page.goto('/');
  await expect(page.locator('#dl')).toBeVisible();

  // Open settings — clear button only appears when credentials are saved
  await page.click('#b');
  await expect(page.locator('#clr')).toBeVisible();

  // Accept the confirmation dialog then click clear
  page.once('dialog', dialog => dialog.accept());
  await page.click('#clr');

  // All three keys should be gone from localStorage
  expect(await page.evaluate(() => localStorage.getItem('uke_shop'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('uke_client_id'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('uke_client_secret'))).toBeNull();

  // Settings re-renders without the clear button since there's nothing to clear
  await expect(page.locator('#clr')).not.toBeAttached();
});

test('download button saves a valid PDF with expected content', async ({ page }) => {
  await page.route('/api/orders', route => route.fulfill({ json: mockSummary }));

  await page.addInitScript(() => {
    localStorage.setItem('uke_shop', 'test.myshopify.com');
    localStorage.setItem('uke_client_id', 'test-client-id');
    localStorage.setItem('uke_client_secret', 'test-secret');
  });

  await page.goto('/');
  await expect(page.locator('#dl')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.click('#dl');
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^uke-\d{4}-\d{2}-\d{2}\.pdf$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  const buffer = fs.readFileSync(filePath!);

  // Valid PDF magic bytes
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');

  // Minimum reasonable size for a jsPDF document with tables
  expect(buffer.length).toBeGreaterThan(10_000);

  // Expected content in the extracted text
  const { text } = await pdfParse(buffer);
  expect(text).toContain('Until Victory');
  expect(text).toContain('Dragon Ball');
  expect(text).toContain('Chicharito');
  expect(text).toContain('#1001');
  expect(text).toContain('#1002');
});
