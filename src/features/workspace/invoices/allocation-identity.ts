/** Database-protected identity. JSON snapshot markers are compatibility data only. */
export interface ProtectedAllocationIdentity {
  readonly version: 1
  readonly workspaceId: string
  readonly invoiceId: string
  readonly requestId: string
  readonly prefix: string
  readonly sequence: number
}
export const MAX_PROTECTED_INVOICE_ITEMS = 8
export function allocationIdentity(header: Record<string, unknown>, workspaceId: string, invoiceId: string): ProtectedAllocationIdentity | undefined {
  if (!Object.hasOwn(header, 'allocation')) return undefined
  const value = header.allocation
  const keys = ['version', 'workspaceId', 'invoiceId', 'requestId', 'prefix', 'sequence']
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid protected invoice allocation identity.')
  const a = value as Record<string, unknown>
  if (Object.keys(a).length !== keys.length || !keys.every(key => Object.hasOwn(a, key))
    || a.version !== 1 || a.workspaceId !== workspaceId || a.invoiceId !== invoiceId
    || ![a.workspaceId, a.invoiceId, a.requestId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))
    || typeof a.prefix !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(a.prefix)
    || typeof a.sequence !== 'number' || !Number.isSafeInteger(a.sequence) || a.sequence < 1 || a.sequence > 1e9
    || header.numberPrefix !== a.prefix || header.numberSequence !== a.sequence) throw new Error('Invalid protected invoice allocation identity.')
  return Object.freeze({ version: 1, workspaceId, invoiceId, requestId: a.requestId as string, prefix: a.prefix, sequence: a.sequence })
}
