export const invoicePreviewProject = 'demo-growthmark-invoice-preview'
export const invoicePreviewPorts = { auth: 9299, firestore: 8380 } as const
export function invoicePreviewMode(value: string | undefined, development: boolean, emulators: boolean): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value !== 'true' || !development || !emulators) throw new Error('Invoice candidate preview requires a development build and local emulators.')
  return true
}
