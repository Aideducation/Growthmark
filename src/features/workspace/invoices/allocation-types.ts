import type { Timestamp } from 'firebase/firestore'

export type ManualInvoiceStatus = 'draft' | 'sent' | 'pending' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceAllocationInput {
  header: {
    clientId: string
    projectId: string | null
    title: string
    state: 'draft'
    issueAt: Timestamp
    dueAt: Timestamp | null
    terms: string
    notes: string
    manualStatus?: ManualInvoiceStatus
  }
  snapshot: { agencyJson: string; clientJson: string; contentJson: string }
  items: Array<{
    id: string
    description: string
    quantityMilli: number
    unitPriceMinor: number
    taxRateBps: number
    discountBps: number
  }>
  override?: InvoicePaymentDetails
}

export interface InvoicePaymentDetails {
  upiEnabled: boolean
  upiId: string
  upiHolder: string
  qr: string
  bankEnabled: boolean
  bankHolder: string
  bankName: string
  accountNumber: string
  ifsc: string
  branch: string
  cashEnabled: boolean
  otherEnabled: boolean
  otherMethod: string
  instructions: string
}

export interface InvoiceAllocationResult {
  readonly invoiceId: string
  readonly requestId: string
  readonly sequence: number
  readonly prefix: string
}

export interface AllocationDocument {
  readonly id: string
  exists(): boolean
  data(): Record<string, unknown> | undefined
}

export interface AllocationTransaction {
  get(path: string): Promise<AllocationDocument>
  set(path: string, data: Record<string, unknown>): void
  update(path: string, data: Record<string, unknown>): void
}

/** Persistence boundary. Implementations must enforce identity and server-backed reads. */
export interface InvoiceAllocationStore {
  readonly ownerId: string
  read(path: string): Promise<AllocationDocument>
  transact<T>(operation: (transaction: AllocationTransaction) => Promise<T>): Promise<T>
  timestamp(): unknown
}
