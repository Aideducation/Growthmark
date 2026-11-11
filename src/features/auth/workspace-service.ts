import type { Auth } from 'firebase/auth'
import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import type { AccountProfile, Workspace } from '../../domain/identity.ts'
import type { OnboardingInput } from './contracts.ts'
import { requireLocalAuth } from './auth-api.ts'
import { requireMatchingFirebase } from '../../services/firebase-mode.ts'

export interface OwnerWorkspace { profile: AccountProfile; workspace: Workspace }

function parse(uid: string, profile: Record<string, unknown>, workspace: Record<string, unknown>): OwnerWorkspace {
  if (profile.userId !== uid || profile.workspaceId !== uid || workspace.ownerId !== uid
    || profile.schemaVersion !== 1 || workspace.schemaVersion !== 1
    || typeof profile.fullName !== 'string' || typeof profile.email !== 'string'
    || typeof profile.phone !== 'string' || typeof profile.whatsapp !== 'string'
    || typeof workspace.name !== 'string' || typeof workspace.timezone !== 'string'
    || typeof workspace.currency !== 'string' || !['INR', 'USD', 'EUR', 'GBP'].includes(workspace.currency)
    || !(profile.createdAt instanceof Timestamp) || !(workspace.createdAt instanceof Timestamp)
    || !['business-profile', 'complete'].includes(String(workspace.onboarding))) {
    throw new Error('Your workspace records could not be validated. No data was changed.')
  }
  return {
    profile: { userId: uid, fullName: profile.fullName, email: profile.email, phone: profile.phone,
      whatsapp: profile.whatsapp, photoFileId: null, createdAt: profile.createdAt.toDate().toISOString() },
    workspace: { id: uid, ownerId: uid, createdAt: workspace.createdAt.toDate().toISOString(),
      name: workspace.name, timezone: workspace.timezone, currency: workspace.currency,
      onboarding: workspace.onboarding as Workspace['onboarding'] },
  }
}
async function verifiedOwner(auth: Auth, db: Firestore) {
  requireLocalAuth(auth)
  requireMatchingFirebase(auth, db)
  if (db.app.options.projectId !== auth.app.options.projectId) throw new Error('Authentication and database projects do not match.')
  const user = auth.currentUser
  if (!user) throw new Error('Sign in before opening a workspace.')
  const token = await user.getIdTokenResult()
  if (!user.emailVerified || token.claims.email_verified !== true || !user.email) throw new Error('Verify your email before opening a workspace.')
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Please try again.')
  return user
}
export async function readOwnerWorkspace(auth: Auth, db: Firestore): Promise<OwnerWorkspace | null> {
  const user = await verifiedOwner(auth, db)
  return runTransaction(db, async transaction => {
    const profile = await transaction.get(doc(db, 'users', user.uid))
    const workspace = await transaction.get(doc(db, 'workspaces', user.uid))
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Please try again.')
    if (!profile.exists() && !workspace.exists()) return null
    if (!profile.exists() || !workspace.exists()) throw new Error('Workspace setup is incomplete. Contact support before continuing.')
    return parse(user.uid, profile.data(), workspace.data())
  })
}
/** No UID or workspace-ID input: both paths always derive from Auth. */
export async function completeOnboarding(auth: Auth, db: Firestore, input: OnboardingInput) {
  const user = await verifiedOwner(auth, db)
  const ownerName = input.ownerName.trim(), businessName = input.businessName.trim()
  if (!ownerName || ownerName.length > 160 || !businessName || businessName.length > 160) throw new Error('Owner and business names must each contain 1 to 160 characters.')
  await runTransaction(db, async transaction => {
    const profileRef = doc(db, 'users', user.uid), workspaceRef = doc(db, 'workspaces', user.uid)
    const profile = await transaction.get(profileRef), workspace = await transaction.get(workspaceRef)
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Please try again.')
    if (profile.exists() !== workspace.exists()) throw new Error('Workspace setup is incomplete. Contact support before continuing.')
    if (profile.exists() && workspace.exists()) {
      const existing = parse(user.uid, profile.data(), workspace.data())
      if (existing.workspace.onboarding === 'complete') return
      transaction.update(profileRef, { fullName: ownerName, email: user.email, updatedAt: serverTimestamp() })
      transaction.update(workspaceRef, { name: businessName, onboarding: 'complete', updatedAt: serverTimestamp() })
      return
    }
    transaction.set(profileRef, { schemaVersion: 1, userId: user.uid, workspaceId: user.uid,
      fullName: ownerName, email: user.email, phone: '', whatsapp: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    transaction.set(workspaceRef, { schemaVersion: 1, ownerId: user.uid, name: businessName,
      currency: 'INR', timezone: 'Asia/Kolkata', onboarding: 'complete', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
  const result = await readOwnerWorkspace(auth, db)
  if (!result) throw new Error('Your workspace could not be loaded. Please try again.')
  return result
}
