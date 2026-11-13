import { validateDraft } from './model.ts'
import type { Agency, InvoiceDraft } from './model.ts'
import type { InvoicePaymentDetails, ManualInvoiceStatus } from './allocation-types.ts'

export const manualStatuses = ['draft', 'sent', 'pending', 'paid', 'overdue', 'cancelled'] as const
export function validateManualStatus(value: unknown): ManualInvoiceStatus {
  if (typeof value !== 'string' || !manualStatuses.some(status => status === value)) throw new Error('Choose a valid manual invoice status.')
  return value as ManualInvoiceStatus
}
export function suggestedPrefix(name: string): string {
  const words = name.normalize('NFKD').replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const stem = (words.length > 1 ? words.map(word => word[0]).join('') : words[0] || '').toUpperCase().slice(0, 12)
  return stem ? `${stem}-INV` : 'INV'
}
export function validateInvoicePrefix(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(value)) throw new Error('Use an invoice prefix of 1–20 letters, numbers or hyphens, starting with a letter or number.')
  return value
}
export function invoiceReference(value: Record<string, unknown> | null | undefined): string {
  if (!value) return ''
  const legacy = typeof value.invoiceNumber === 'string' && value.invoiceNumber.length <= 160 ? value.invoiceNumber : ''
  if (value.numberPrefix === undefined || value.numberSequence === undefined) return legacy
  let prefix: string
  try { prefix = validateInvoicePrefix(value.numberPrefix) } catch { return legacy }
  if (typeof value.numberSequence !== 'number' || !Number.isSafeInteger(value.numberSequence) || value.numberSequence < 1 || value.numberSequence > 1e9) return legacy
  return `${prefix}-${String(value.numberSequence).padStart(6, '0')}`
}
const paymentStrings = { upiId: 200, upiHolder: 160, qr: 45000, bankHolder: 160, bankName: 160, accountNumber: 80, ifsc: 30, branch: 160, otherMethod: 160, instructions: 3000 } as const
const paymentBooleans = ['upiEnabled', 'bankEnabled', 'cashEnabled', 'otherEnabled'] as const
export function validatePaymentDetails(value: unknown): InvoicePaymentDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid invoice payment details.')
  const p = value as Record<string, unknown>, keys = [...paymentBooleans, ...Object.keys(paymentStrings)]
  if (Object.keys(p).length !== keys.length || !keys.every(key => Object.hasOwn(p, key))) throw new Error('Unexpected invoice payment fields.')
  for (const key of paymentBooleans) if (typeof p[key] !== 'boolean') throw new Error('Choose enabled or disabled payment methods.')
  for (const [key, max] of Object.entries(paymentStrings)) if (typeof p[key] !== 'string' || p[key].length > max) throw new Error('Invoice payment details exceed the allowed size.')
  const details = p as unknown as InvoicePaymentDetails
  if (details.qr && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(details.qr)) throw new Error('Use an uploaded PNG for the invoice QR.')
  if (details.upiEnabled && !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(details.upiId)) throw new Error('Enter a valid UPI ID.')
  if (details.bankEnabled && (!details.bankHolder.trim() || !details.bankName.trim() || !/^[0-9]{6,34}$/.test(details.accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(details.ifsc))) throw new Error('Complete the bank holder, bank name, account number and IFSC.')
  if (details.otherEnabled && !details.otherMethod.trim()) throw new Error('Enter the other payment method name.')
  return structuredClone(details)
}
export function originalPaymentDetails(agency: Agency): InvoicePaymentDetails {
  return { upiEnabled: agency.upiEnabled === 'true', upiId: agency.upiId, upiHolder: agency.upiHolder, qr: agency.qr, bankEnabled: agency.bankEnabled === 'true', bankHolder: agency.bankHolder, bankName: agency.bankName, accountNumber: agency.accountNumber, ifsc: agency.ifsc, branch: agency.branch, cashEnabled: agency.cashEnabled === 'true', otherEnabled: agency.otherEnabled === 'true', otherMethod: agency.otherMethod, instructions: agency.instructions }
}
export function agencyWithPaymentDetails(agency: Agency, details?: InvoicePaymentDetails): Agency {
  if (!details) return agency
  const p = details
  return { ...agency, ...Object.fromEntries(Object.entries(p).map(([key, value]) => [key, typeof value === 'boolean' ? String(value) : value])) }
}
export function resolveInvoiceDraft(draft: InvoiceDraft, details?: InvoicePaymentDetails): InvoiceDraft {
  return validateDraft({ ...draft, agency: agencyWithPaymentDetails(draft.agency, details ? validatePaymentDetails(details) : undefined) })
}
export interface InvoicePresentation {
  reference?: string
  manualStatus?: ManualInvoiceStatus
  paymentOverride?: InvoicePaymentDetails
}
