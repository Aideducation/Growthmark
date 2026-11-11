import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { Timestamp } from 'firebase/firestore'
import { createDraftPdf } from '../../src/features/workspace/pdf.ts'
import { csvText } from '../../src/features/workspace/export.ts'

const font = (await readFile(new URL('../../public/fonts/NotoSans-Regular.ttf', import.meta.url))).toString('base64')
test('CSV export: quotes delimiters and neutralizes formula-injection inputs, including leading whitespace', () => {
  for (const payload of ['=1+1', '+SUM(A1:A2)', '-1+1', '@SUM(A1)', '  =HYPERLINK("test")', '\t=1', '\n=1']) {
    const result = csvText([{ value: payload }])
    assert.ok(result.split('\r\n')[1].startsWith('"\''))
  }
  assert.ok(csvText([{ value: 'A, "quoted" name' }]).includes('"A, ""quoted"" name"'))
  assert.equal(csvText([]), '')
})
for (const kind of ['quotations', 'invoices']) {
  test(`PDF export: ${kind} generates a marked, embedded-font, multipage PDF from real line inputs`, async () => {
    const record = { id: 'qa-only-export', revision: 1, title: '[QA] PDF export verification', issueAt: Timestamp.fromDate(new Date('2026-11-10')), dueAt: null, terms: 'QA terms '.repeat(200), notes: 'This is a disposable test artifact, not a business invoice.' }
    const lines = Array.from({ length: 30 }, (_, index) => ({ id: String(index), revision: 1, description: `[QA] Service ${index + 1} – José consulting`, quantityMilli: 2500, unitPriceMinor: 10001, taxRateBps: 1800, discountBps: 1000 }))
    const bytes = await createDraftPdf({ kind, record, lines, currency: 'INR', businessName: '[QA] Export test only', client: { id: 'qa-client', revision: 1, name: '[QA] Test recipient' } }, font)
    const contents = Buffer.from(bytes).toString('latin1')
    assert.ok(contents.startsWith('%PDF-'))
    assert.match(contents, /DRAFT - NOT ISSUED/)
    assert.match(contents, /GrowthMark draft/)
    assert.ok((contents.match(/\/Type \/Page\b/g) ?? []).length >= 3)
    assert.match(contents, /\/FontFile2/)
    assert.ok(contents.trimEnd().endsWith('%%EOF'))
    const directory = new URL('./results/', import.meta.url); await mkdir(directory, { recursive: true })
    await writeFile(new URL(`qa-${kind}.pdf`, directory), bytes)
  })
}
