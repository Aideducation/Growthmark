import { scaledInteger } from '../money.ts'

export const agencySections: Record<string, Record<string, string>> = {
  'Business identity': { name: 'Agency name', ownerName: 'Owner name', businessType: 'Business type', email: 'Business email', phone: 'Phone', whatsapp: 'WhatsApp', website: 'Website', address: 'Street address', city: 'City', state: 'State', postalCode: 'PIN code', country: 'Country', pan: 'PAN (optional)', gstin: 'GSTIN (optional)' },
  'GST preferences': { gstEnabled: 'GST enabled', defaultGst: 'Preferred GST rate (%)', priceMode: 'Pricing', gstMode: 'GST breakdown' },
  'Payment information': { upiEnabled: 'Enable UPI', upiId: 'UPI ID', upiHolder: 'UPI account holder', bankEnabled: 'Enable bank transfer', bankHolder: 'Bank account holder', bankName: 'Bank name', accountNumber: 'Account number', ifsc: 'IFSC code', branch: 'Branch', cashEnabled: 'Accept cash', otherEnabled: 'Accept another method', otherMethod: 'Other method name', instructions: 'Payment instructions' },
  'Invoice branding': { prefix: 'Invoice prefix (reserved for issuance)', currency: 'Preferred invoice currency', dueDays: 'Default due period (days)', paymentTerms: 'Payment terms', footer: 'Footer', notes: 'Default notes', terms: 'Terms and conditions', brandColor: 'Brand colour', signatureName: 'Authorized signature name' },
}
export type Agency = Record<string, string>
export const agencyKeys = [...Object.values(agencySections).flatMap(section => Object.keys(section)), 'logo', 'qr', 'signature']
export function defaultAgency(): Agency {
  return { ...Object.fromEntries(agencyKeys.map(key => [key, ''])), gstEnabled: 'false', defaultGst: '0', priceMode: 'exclusive', gstMode: 'split', upiEnabled: 'false', bankEnabled: 'false', cashEnabled: 'false', otherEnabled: 'false', prefix: 'GM-INV', currency: 'INR', dueDays: '14', brandColor: '#10B981', country: 'India' }
}
export function validateAgency(value: unknown): Agency {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid agency profile.')
  const profile = value as Agency
  if (Object.keys(profile).length !== agencyKeys.length || Object.keys(profile).some(key => !agencyKeys.includes(key))) throw new Error('Agency profile contains unexpected fields.')
  for (const key of agencyKeys) {
    if (typeof profile[key] !== 'string' || profile[key].length > (['logo', 'qr', 'signature'].includes(key) ? 45000 : 3000)) throw new Error(`Invalid ${key}.`)
  }
  for (const key of ['logo', 'qr', 'signature']) if (profile[key] && !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(profile[key])) throw new Error('Images must be uploaded PNG data, not remote links or SVG.')
  for (const key of ['gstEnabled', 'upiEnabled', 'bankEnabled', 'cashEnabled', 'otherEnabled']) if (!['true', 'false'].includes(profile[key])) throw new Error('Choose enabled or disabled.')
  if (!profile.name.trim() || profile.name.length > 160 || profile.ownerName.length > 160) throw new Error('Enter an agency name of up to 160 characters.')
  if (!['INR', 'USD', 'EUR', 'GBP'].includes(profile.currency) || !['inclusive', 'exclusive'].includes(profile.priceMode) || !['split', 'igst'].includes(profile.gstMode)) throw new Error('Invalid invoice preferences.')
  if (!/^#[0-9a-fA-F]{6}$/.test(profile.brandColor) || !/^[A-Za-z0-9-]{1,20}$/.test(profile.prefix)) throw new Error('Use a hex colour and an invoice prefix containing letters, numbers or hyphens.')
  if (!/^\d{1,3}$/.test(profile.dueDays) || Number(profile.dueDays) > 365 || scaledInteger(profile.defaultGst) > 10000) throw new Error('Check the due period and GST rate (0–100%).')
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('Enter a valid business email.')
  if (profile.website && !/^https?:\/\/[^\s]+$/i.test(profile.website)) throw new Error('Website must begin with https:// or http://.')
  if (JSON.stringify(profile).length > 150000) throw new Error('Agency profile is too large. Use smaller images and shorter text.')
  return structuredClone(profile)
}
export interface InvoiceLine { id: string; name: string; description: string; quantity: string; unit: string; rate: string; discountKind: string; discount: string; gst: string }
export interface ClientSnapshot { name: string; company: string; contact: string; email: string; phone: string; whatsapp: string; address: string; gstin: string }
export interface InvoiceDraft { version: 1; agency: Agency; client: ClientSnapshot; title: string; date: string; due: string; currency: string; priceMode: string; gstMode: string; gstEnabled: boolean; discountKind: string; discount: string; charges: string; notes: string; terms: string; methods: string[]; lines: InvoiceLine[] }
export const services = ['Social Media Management', 'Meta Ads Management', 'Website Development', 'App Development', 'Graphic Design', 'SEO Services', 'Marketing Consultation', 'Custom Services']
export function newLine(id: string = crypto.randomUUID()): InvoiceLine { return { id, name: '', description: '', quantity: '1', unit: 'service', rate: '0', discountKind: 'percent', discount: '0', gst: '0' } }
const round = (n: bigint, d: bigint) => (n + d / 2n) / d
const safe = (n: bigint) => { if (n < 0n || n > 1000000000000n) throw new Error('Invoice amount is outside the supported range.'); return Number(n) }
function discount(base: bigint, kind: string, value: string) {
  const amount = BigInt(scaledInteger(value || '0'))
  if (!['percent', 'fixed'].includes(kind) || (kind === 'percent' && amount > 10000n)) throw new Error('Discount must be 0–100%, or a fixed amount.')
  const result = kind === 'percent' ? round(base * amount, 10000n) : amount
  if (result > base) throw new Error('Discount cannot exceed the amount being discounted.')
  return result
}
/** Integer minor units and BigInt only. Discounts apply to quoted prices before GST extraction/addition.
 * Allocate overall discount proportionally, with the final nonzero line absorbing the rounding remainder.
 * Additional charges are explicitly non-taxable. Split GST assigns any odd minor unit to SGST. */
export function calculateInvoice(draft: InvoiceDraft) {
  if (!['inclusive', 'exclusive'].includes(draft.priceMode) || !['split', 'igst'].includes(draft.gstMode) || !Array.isArray(draft.lines) || draft.lines.length > 50) throw new Error('Invalid invoice pricing or too many items (maximum 50).')
  const initial = draft.lines.map(line => {
    const quantity = scaledInteger(line.quantity, 3), rate = scaledInteger(line.rate)
    if (quantity < 1 || quantity > 1000000000 || rate > 1000000000000) throw new Error('Check quantity and rate.')
    const tax = scaledInteger(line.gst || '0'); if (tax > 10000) throw new Error('GST must be between 0 and 100%.')
    const gross = round(BigInt(quantity) * BigInt(rate), 1000n), reduction = discount(gross, line.discountKind, line.discount)
    return { line, gross, reduction, net: gross - reduction, rate: BigInt(draft.gstEnabled ? tax : 0) }
  })
  const base = initial.reduce((sum, line) => sum + line.net, 0n), overall = discount(base, draft.discountKind, draft.discount)
  let remaining = overall
  let last = -1
  initial.forEach((line, index) => { if (line.net > 0n) last = index })
  const lines = initial.map((item, index) => {
    const allocation = index === last ? remaining : base ? item.net * overall / base : 0n
    remaining -= allocation
    const discounted = item.net - allocation
    const tax = draft.priceMode === 'inclusive' ? round(discounted * item.rate, 10000n + item.rate) : round(discounted * item.rate, 10000n)
    const taxable = draft.priceMode === 'inclusive' ? discounted - tax : discounted
    return { id: item.line.id, gross: safe(item.gross), itemDiscount: safe(item.reduction), overallDiscount: safe(allocation), taxable: safe(taxable), tax: safe(tax), total: safe(taxable + tax) }
  })
  const sum = (key: keyof Omit<typeof lines[number], 'id'>) => safe(lines.reduce((total, line) => total + BigInt(line[key]), 0n))
  const charges = scaledInteger(draft.charges || '0'), tax = sum('tax')
  return { lines, subtotal: sum('gross'), itemDiscount: sum('itemDiscount'), overallDiscount: safe(overall), taxable: sum('taxable'), tax, cgst: draft.gstMode === 'split' ? Math.floor(tax / 2) : 0, sgst: draft.gstMode === 'split' ? tax - Math.floor(tax / 2) : 0, igst: draft.gstMode === 'igst' ? tax : 0, charges, total: safe(BigInt(sum('total')) + BigInt(charges)) }
}
export function validateDraft(value: unknown): InvoiceDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid invoice.')
  const d = value as InvoiceDraft
  if (Object.keys(d).sort().join() !== ['version','agency','client','title','date','due','currency','priceMode','gstMode','gstEnabled','discountKind','discount','charges','notes','terms','methods','lines'].sort().join()) throw new Error('Invoice contains unexpected fields.')
  if (d.version !== 1 || typeof d.gstEnabled !== 'boolean') throw new Error('Unsupported invoice format.')
  validateAgency(d.agency)
  const clientKeys = ['name', 'company', 'contact', 'email', 'phone', 'whatsapp', 'address', 'gstin']
  if (!d.client || Object.keys(d.client).length !== clientKeys.length || clientKeys.some(key => typeof d.client[key as keyof ClientSnapshot] !== 'string' || d.client[key as keyof ClientSnapshot].length > 1000)) throw new Error('Invalid client snapshot.')
  for (const key of ['title', 'notes', 'terms', 'date', 'due', 'currency', 'discountKind', 'discount', 'charges'] as const) if (typeof d[key] !== 'string' || d[key].length > (key === 'title' ? 200 : 5000)) throw new Error(`Invalid ${key}.`)
  if (!d.title.trim() || !d.client.name.trim() || !['INR', 'USD', 'EUR', 'GBP'].includes(d.currency)) throw new Error('Enter an invoice title, client and supported currency.')
  for (const date of [d.date, d.due].filter(Boolean)) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('Invalid invoice date.')
  if (!d.date || d.due && d.due < d.date) throw new Error('Due date cannot precede the invoice date.')
  if (!Array.isArray(d.methods) || new Set(d.methods).size !== d.methods.length || d.methods.some(method => !['upi', 'bank', 'cash', 'other'].includes(method) || d.agency[`${method}Enabled`] !== 'true')) throw new Error('Select only enabled agency payment methods.')
  if (d.methods.includes('upi') && !d.agency.upiId || d.methods.includes('bank') && (!d.agency.bankName || !d.agency.accountNumber || !d.agency.bankHolder || !d.agency.ifsc)) throw new Error('Complete payment details before displaying that method.')
  if (!d.lines.length || new Set(d.lines.map(line => line.id)).size !== d.lines.length) throw new Error('Add at least one unique invoice item.')
  for (const line of d.lines) {
    if (!line || Object.keys(line).sort().join() !== ['id','name','description','quantity','unit','rate','discountKind','discount','gst'].sort().join() || Object.values(line).some(value => typeof value !== 'string' || value.length > 2000) || !/^[A-Za-z0-9_-]{1,100}$/.test(line.id) || !line.name.trim()) throw new Error('Check service names and invoice items.')
    if (line.name.length > 200 || line.unit.length > 30) throw new Error('Service names must be at most 200 characters and units at most 30.')
  }
  calculateInvoice(d)
  if (JSON.stringify(d).length > 220000) throw new Error('Invoice snapshot is too large. Use smaller images or shorter descriptions.')
  return structuredClone(d)
}
