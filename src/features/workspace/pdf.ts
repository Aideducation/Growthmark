import { jsPDF } from 'jspdf'
import { calculateDocument, calculateLine } from './money.ts'
import { dateValue, num, str } from './schema.ts'
import type { RecordRow } from './schema'

let fontPromise: Promise<string> | undefined
function font() {
  if (!fontPromise) fontPromise = fetch('/fonts/NotoSans-Regular.ttf').then(async response => {
    if (!response.ok) throw new Error('The PDF font could not be loaded. Try again when the app is connected.')
    const data = new Uint8Array(await response.arrayBuffer())
    let binary = ''; for (const byte of data) binary += String.fromCharCode(byte)
    return btoa(binary)
  }).catch(error => { fontPromise = undefined; throw error })
  return fontPromise
}
export interface DraftPdfInput { kind: 'quotations' | 'invoices'; record: RecordRow; lines: RecordRow[]; client?: RecordRow; business?: RecordRow | null; businessName: string; currency: string; footer?: string }
export async function createDraftPdf(input: DraftPdfInput, embeddedFont?: string): Promise<Uint8Array> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  pdf.addFileToVFS('NotoSans.ttf', embeddedFont ?? await font()); pdf.addFont('NotoSans.ttf', 'NotoSans', 'normal'); pdf.setFont('NotoSans')
  pdf.setProperties({ title: 'GrowthMark draft ' + (input.kind === 'invoices' ? 'invoice' : 'quotation'), subject: 'DRAFT - NOT ISSUED', creator: 'GrowthMark' })
  const totals = calculateDocument(input.lines)
  const amount = (value: number) => `${input.currency} ${(value / 100).toFixed(2)}`
  let y = 20
  function nextPage(height = 10) { if (y + height > 272) { pdf.addPage(); y = 20 } }
  function text(value: string, size = 10, color: [number, number, number] = [23, 28, 27]) {
    pdf.setFontSize(size); pdf.setTextColor(...color)
    const lines: string[] = pdf.splitTextToSize(value || ' ', 170)
    for (const line of lines) { nextPage(7); pdf.text(line, 20, y); y += size > 16 ? 9 : 6 }
  }
  text(str(input.business, 'name') || input.businessName, 21)
  text(`DRAFT ${input.kind === 'invoices' ? 'INVOICE' : 'QUOTATION'}`, 14, [4, 120, 87])
  text('Not issued. Estimates only. No official invoice number or payment confirmation.', 9, [107, 114, 128])
  text(str(input.business, 'email')); text(str(input.business, 'phone'))
  const address = ['street', 'city', 'state', 'country', 'postalCode'].map(key => str(input.business, key)).filter(Boolean).join(', ')
  if (address) text(address)
  if (str(input.business, 'gstin')) text(`GSTIN: ${str(input.business, 'gstin')}`)
  y += 5; text(str(input.record, 'title'), 15)
  text(`Date: ${dateValue(input.record.issueAt)}    Due / expiry: ${dateValue(input.record.dueAt) || 'Not set'}`)
  text(`Prepared for: ${str(input.client, 'name') || 'Linked client'}`)
  if (str(input.client, 'company')) text(str(input.client, 'company'))
  if (str(input.client, 'email')) text(str(input.client, 'email'))
  y += 5
  for (let index = 0; index < input.lines.length; index++) {
    const line = input.lines[index], result = calculateLine(line)
    nextPage(22); pdf.setDrawColor(229, 231, 235); pdf.line(20, y, 190, y); y += 7
    text(`${index + 1}. ${str(line, 'description')}`, 11)
    text(`Qty ${(num(line, 'quantityMilli') / 1000).toFixed(3)} × ${amount(num(line, 'unitPriceMinor'))} | Discount ${(num(line, 'discountBps') / 100).toFixed(2)}% | Tax ${(num(line, 'taxRateBps') / 100).toFixed(2)}%`, 9)
    text(`Line total: ${amount(result.total)}`)
  }
  y += 7; nextPage(36)
  text(`Subtotal: ${amount(totals.subtotal)}`); text(`Discount: ${amount(totals.discount)}`); text(`Tax: ${amount(totals.tax)}`); text(`DRAFT TOTAL: ${amount(totals.total)}`, 15, [4, 120, 87])
  if (str(input.record, 'terms')) { y += 5; text('Terms', 12); text(str(input.record, 'terms')) }
  if (str(input.record, 'notes')) { y += 5; text('Notes', 12); text(str(input.record, 'notes')) }
  if (input.footer) { y += 5; text(input.footer, 9, [107, 114, 128]) }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(107, 114, 128); pdf.text(`DRAFT · ${page} / ${pages} · Private document exported by workspace owner`, 20, 288) }
  return new Uint8Array(pdf.output('arraybuffer'))
}

export async function downloadDraftPdf(input: DraftPdfInput) {
  const data = await createDraftPdf(input)
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }))
  const link = document.createElement('a'); link.href = url
  link.download = 'GrowthMark-Draft-' + (input.kind === 'invoices' ? 'Invoice' : 'Quotation') + '-' + input.record.id.slice(0, 8) + '.pdf'
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
}
