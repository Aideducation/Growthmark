import type { AccountProfile, Workspace } from '../../domain/identity'

export interface RegistrationInput {
  fullName: string
  email: string
  /** Transient input to Auth only. Never persist, log or copy into Firestore. */
  password: string
}

export interface OnboardingInput { ownerName: string; businessName: string }

export interface AuthenticatedIdentity {
  readonly userId: string
  readonly email: string | null
  readonly emailVerified: boolean
  readonly displayName: string | null
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'verification-required'; identity: AuthenticatedIdentity }
  | { status: 'onboarding'; identity: AuthenticatedIdentity }
  | { status: 'ready'; identity: AuthenticatedIdentity; profile: AccountProfile; workspace: Workspace }
  | { status: 'suspended' }
  | { status: 'error'; message: string }
  | { status: 'live-disabled' }
