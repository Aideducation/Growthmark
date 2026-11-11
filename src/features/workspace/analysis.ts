import { Timestamp } from 'firebase/firestore'
import type { RecordRow } from './schema.ts'
import { num, str } from './schema.ts'

export function today(timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
export function paymentDay(row: RecordRow, timezone: string) { return row.paidAt instanceof Timestamp ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(row.paidAt.toDate()) : '' }
export function paymentSum(rows: RecordRow[]) { const total = rows.reduce((sum, row) => sum + num(row, 'amountMinor'), 0); if (!Number.isSafeInteger(total)) throw new Error('Collection total exceeds the supported range.'); return total }
export function groupCollections(rows: RecordRow[], field: string, name: (key: string) => string) {
  const groups = new Map<string, RecordRow[]>()
  for (const row of rows) { const key = str(row, field) || 'unassigned'; groups.set(key, [...groups.get(key) ?? [], row]) }
  return [...groups.entries()].map(([id, records]) => ({ id, name: name(id), count: records.length, total: paymentSum(records) })).sort((a, b) => b.total - a.total)
}
export function monthlyCollections(rows: RecordRow[], timezone: string) {
  const date = new Date(`${today(timezone)}T12:00:00Z`)
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 5 + index, 1)), key = month.toISOString().slice(0, 7)
    return { key, label: month.toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), total: paymentSum(rows.filter(row => paymentDay(row, timezone).startsWith(key))) }
  })
}
