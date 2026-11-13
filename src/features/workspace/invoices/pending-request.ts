export interface PendingInvoiceRequest {
  version: 1
  ownerId: string
  invoiceId: string
  requestId: string
  submitted: boolean
}
export interface RequestStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const key = (ownerId: string) => `growthmark:invoice-candidate:${ownerId}`
export function readPendingRequest(storage: RequestStorage, ownerId: string): PendingInvoiceRequest | null {
  const raw = storage.getItem(key(ownerId))
  if (raw === null) return null
  let value: PendingInvoiceRequest
  try { value = JSON.parse(raw) as PendingInvoiceRequest } catch { throw new Error('The pending invoice request is unreadable. Do not start another save until it is reviewed.') }
  if (!value || Object.keys(value).sort().join() !== 'invoiceId,ownerId,requestId,submitted,version' || value.version !== 1 || value.ownerId !== ownerId || typeof value.submitted !== 'boolean' || ![value.ownerId, value.invoiceId, value.requestId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid pending invoice request. No new invoice was started.')
  return value
}
export function keepPendingRequest(storage: RequestStorage, request: PendingInvoiceRequest): void {
  storage.setItem(key(request.ownerId), JSON.stringify(request))
}
export function clearPendingRequest(storage: RequestStorage, ownerId: string): void { storage.removeItem(key(ownerId)) }
