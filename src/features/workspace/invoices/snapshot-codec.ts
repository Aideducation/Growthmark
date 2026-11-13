import { validateDraft } from './model.ts'
import type { InvoiceDraft } from './model.ts'
import type { InvoicePaymentDetails } from './allocation-types.ts'
import { agencyWithPaymentDetails, validatePaymentDetails } from './workflow.ts'
import type { ProtectedAllocationIdentity } from './allocation-identity.ts'

/** Service metadata, deliberately separate from the editable/presentation draft. */
export interface InvoiceAllocationMetadata {
  readonly version: 1
  readonly invoiceId: string
  readonly requestId: string
}

export interface DecodedInvoiceSnapshot {
  draft: InvoiceDraft
  allocation?: InvoiceAllocationMetadata
}

/** Leave space below Firestore's 1 MiB document limit for metadata and field names. */
export function validateSnapshotByteSize(value: { agencyJson: string; clientJson: string; contentJson: string }): void {
  const encoder = new TextEncoder()
  if (encoder.encode(value.agencyJson).byteLength + encoder.encode(value.clientJson).byteLength + encoder.encode(value.contentJson).byteLength > 900000) {
    throw new Error('Invoice snapshot exceeds the supported UTF-8 byte size. No changes were saved.')
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateAllocationMetadata(value: unknown, invoiceId: string): InvoiceAllocationMetadata {
  const invalid = () => new Error('Invalid invoice allocation metadata. No changes were saved.')
  if (!record(value) || Reflect.ownKeys(value).length !== 3
    || !['invoiceId', 'requestId', 'version'].every(key => Object.hasOwn(value, key))) throw invalid()
  if (value.version !== 1 || typeof value.invoiceId !== 'string' || typeof value.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.invoiceId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value.requestId)
    || value.invoiceId !== invoiceId) throw invalid()
  return Object.freeze({ version: 1, invoiceId: value.invoiceId, requestId: value.requestId })
}

export function decodeInvoiceSnapshot(data: Record<string, unknown>, invoiceId: string, paymentOverride?: InvoicePaymentDetails, protectedIdentity?: ProtectedAllocationIdentity): DecodedInvoiceSnapshot {
  if (typeof data.contentJson !== 'string' || typeof data.agencyJson !== 'string' || typeof data.clientJson !== 'string') {
    throw new Error('Invalid invoice snapshot. No changes were saved.')
  }
  // Preserve JSON parse errors; never reinterpret malformed candidate data as legacy.
  const parsed: unknown = JSON.parse(data.contentJson)
  if (!record(parsed)) throw new Error('Invalid invoice snapshot content. No changes were saved.')
  const hasAllocation = Object.hasOwn(parsed, '_allocation')
  const allocation = protectedIdentity
    ? validateAllocationMetadata({ version: 1, invoiceId: protectedIdentity.invoiceId, requestId: protectedIdentity.requestId }, invoiceId)
    : hasAllocation ? validateAllocationMetadata(parsed._allocation, invoiceId) : undefined
  const { _allocation: ignoredAllocation, ...content } = parsed
  void ignoredAllocation
  const agency = JSON.parse(data.agencyJson)
  const draft = validateDraft({ ...content, agency, client: JSON.parse(data.clientJson) }, paymentOverride ? agencyWithPaymentDetails(agency, validatePaymentDetails(paymentOverride)) : undefined)
  return allocation ? { draft, allocation } : { draft }
}

/** Only call with metadata read/validated from the transaction's stored snapshot. */
export function encodeInvoiceContent(draft: InvoiceDraft, allocation?: InvoiceAllocationMetadata): string {
  const { agency, client, ...content } = draft
  void agency; void client
  const json = JSON.stringify(allocation ? { ...content, _allocation: allocation } : content)
  if (json.length > 220000) throw new Error('Invoice content is too large. No changes were saved.')
  return json
}
