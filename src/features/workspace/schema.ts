import { Timestamp } from 'firebase/firestore'

export type Entity = 'clients' | 'projects' | 'tasks' | 'quotations' | 'invoices' | 'payments'
export type SettingsKind = 'business' | 'payment' | 'invoice'
export interface RecordRow { id: string; revision: number; [key: string]: unknown }
export type InputValues = Record<string, string>
export interface Field { key: string; label: string; type?: 'text' | 'email' | 'textarea' | 'number' | 'money' | 'date' | 'datetime-local' | 'client' | 'project' | 'select'; required?: boolean; options?: readonly string[]; max?: number; min?: number; immutable?: boolean; hint?: string }
const clientField: Field = { key: 'clientId', label: 'Client', type: 'client', required: true }
const projectField: Field = { key: 'projectId', label: 'Project (optional)', type: 'project' }
const notes: Field = { key: 'notes', label: 'Notes', type: 'textarea', max: 5000 }
const draftFields: Field[] = [{ ...clientField, immutable: true }, projectField, { key: 'title', label: 'Document title', required: true, max: 200 }, { key: 'issueAt', label: 'Document date', type: 'date', required: true }, { key: 'dueAt', label: 'Due / expiry date', type: 'date' }, { key: 'terms', label: 'Terms', type: 'textarea', max: 5000 }, notes]
export const entityFields: Record<Entity, Field[]> = {
  clients: [{ key: 'name', label: 'Client name', required: true, max: 160 }, { key: 'company', label: 'Company', max: 160 }, { key: 'email', label: 'Email', type: 'email', max: 254 }, { key: 'phone', label: 'Phone', max: 40 }, { key: 'whatsapp', label: 'WhatsApp', max: 40 }, { key: 'address', label: 'Address', type: 'textarea', max: 1000 }, { key: 'services', label: 'Services', type: 'textarea', max: 2000 }, notes, { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'archived'] }],
  projects: [{ ...clientField, immutable: true }, { key: 'name', label: 'Project name', required: true, max: 160 }, { key: 'description', label: 'Description', type: 'textarea', max: 5000 }, { key: 'serviceCategory', label: 'Service category', max: 120, hint: 'Meta Ads, Google Ads, Design, Development, SEO, Automation, Consulting—or your own service.' }, { key: 'budgetMinor', label: 'Budget', type: 'money', min: 0 }, { key: 'startAt', label: 'Start date', type: 'date' }, { key: 'deadlineAt', label: 'Deadline', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['planned', 'active', 'on-hold', 'completed', 'cancelled', 'archived'] }, { key: 'progressPercent', label: 'Progress (%)', type: 'number', min: 0, max: 100 }, notes],
  tasks: [{ ...clientField, label: 'Client (optional)', required: false }, projectField, { key: 'title', label: 'Task title', required: true, max: 200 }, { key: 'description', label: 'Description', type: 'textarea', max: 5000 }, { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'] }, { key: 'dueAt', label: 'Due date', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['todo', 'in-progress', 'completed', 'cancelled'] }],
  quotations: draftFields,
  invoices: draftFields,
  payments: [clientField, projectField, { key: 'amountMinor', label: 'Amount received', type: 'money', required: true, min: 0.01 }, { key: 'paidAt', label: 'Payment date and time', type: 'datetime-local', required: true }, { key: 'method', label: 'Payment method', type: 'select', options: ['upi', 'bank-transfer', 'cash', 'other'] }, { key: 'transactionReference', label: 'Transaction reference', max: 200 }, { ...notes, max: 3000 }],
}
export const settingsFields: Record<SettingsKind, Field[]> = {
  business: [{ key: 'name', label: 'Business name', required: true, max: 160 }, { key: 'businessType', label: 'Business type', max: 100 }, { key: 'industry', label: 'Industry', max: 100 }, { key: 'email', label: 'Business email', type: 'email', max: 254 }, { key: 'phone', label: 'Business phone', max: 40 }, { key: 'whatsapp', label: 'WhatsApp', max: 40 }, { key: 'website', label: 'Website', max: 500 }, { key: 'street', label: 'Street address', type: 'textarea', max: 1000 }, { key: 'city', label: 'City', max: 120 }, { key: 'state', label: 'State', max: 120 }, { key: 'country', label: 'Country', max: 120 }, { key: 'postalCode', label: 'Postal code', max: 30 }, { key: 'gstin', label: 'GSTIN (optional)', max: 30 }],
  payment: [{ key: 'upiId', label: 'UPI ID', max: 200 }, { key: 'accountHolder', label: 'Account holder', max: 160 }, { key: 'bankName', label: 'Bank name', max: 160 }, { key: 'accountNumber', label: 'Account number', max: 80 }, { key: 'ifsc', label: 'IFSC', max: 30 }, { key: 'instructions', label: 'Payment instructions', type: 'textarea', max: 3000 }],
  invoice: [{ key: 'invoicePrefix', label: 'Invoice prefix (reserved for issuance)', max: 20 }, { key: 'quotationPrefix', label: 'Quotation prefix', max: 20 }, { key: 'paymentTermsDays', label: 'Default payment terms (days)', type: 'number', min: 0, max: 365 }, { key: 'defaultTaxBps', label: 'Default tax (%)', type: 'money', min: 0, max: 100 }, { key: 'defaultDiscountBps', label: 'Default discount (%)', type: 'money', min: 0, max: 100 }, { key: 'footer', label: 'Footer', type: 'textarea', max: 2000 }, { key: 'thankYouMessage', label: 'Thank-you message', max: 1000 }],
}
export function str(row: Record<string, unknown> | undefined | null, key: string): string { const value = row?.[key]; return typeof value === 'string' ? value : '' }
export function num(row: Record<string, unknown> | undefined | null, key: string): number { const value = row?.[key]; return typeof value === 'number' ? value : 0 }
export function dateValue(value: unknown): string { return value instanceof Timestamp ? value.toDate().toISOString().slice(0, 10) : '' }
export function label(value: string) { return value.replaceAll('-', ' ').replaceAll('_', ' ') }
export function inputValues(fields: Field[], row?: RecordRow | null): InputValues {
  return Object.fromEntries(fields.map(field => {
    const value = row?.[field.key]
    let output = value instanceof Timestamp ? field.type === 'datetime-local'
      ? new Date(value.toMillis() - new Date(value.toMillis()).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : dateValue(value) : field.type === 'money' && typeof value === 'number' ? (value / 100).toFixed(2) : value == null ? '' : String(value)
    if (!row && field.type === 'select') output = field.options?.[0] ?? ''
    if (!row && field.type === 'number') output = '0'
    if (!row && field.type === 'money') output = '0.00'
    if (!row && field.key === 'issueAt') output = new Date().toISOString().slice(0, 10)
    if (!row && field.type === 'datetime-local') output = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    return [field.key, output]
  }))
}
