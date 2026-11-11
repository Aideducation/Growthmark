import type { IsoTimestamp } from '../../domain/identity'

export interface Address {
  street: string
  city: string
  state: string
  country: string
  postalCode: string
}

export interface BusinessSettings {
  name: string
  logoFileId: string | null
  businessType: string
  industry: string
  email: string
  phone: string
  whatsapp: string
  website: string
  address: Address
  gstin: string | null
}

export interface BankDetails {
  accountHolder: string
  bankName: string
  accountNumber: string
  ifsc: string
}

/** Private workspace settings; never return this object from a public endpoint. */
export interface PaymentSettings {
  upiId: string | null
  qrFileId: string | null
  bank: BankDetails | null
  instructions: string
}

export interface InvoiceSettings {
  prefix: string
  currency: string
  paymentTermsDays: number
  footer: string
  thankYouMessage: string
  signatureFileId: string | null
  designId: string
}

/** Persist an immutable copy at issuance, including immutable asset versions. */
export interface IssuedIdentitySnapshot {
  readonly schemaVersion: 1
  readonly capturedAt: IsoTimestamp
  readonly business: Readonly<BusinessSettings>
  readonly selectedPaymentDetails: Readonly<Partial<PaymentSettings>>
  readonly branding: Readonly<InvoiceSettings>
  readonly assetVersionIds: readonly string[]
}
