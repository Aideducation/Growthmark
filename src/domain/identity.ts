/** Contracts only: these types do not authenticate or authorize requests. */
export type UserId = string
export type WorkspaceId = string
export type IsoTimestamp = string

export interface AccountProfile {
  readonly userId: UserId
  fullName: string
  email: string
  phone: string | null
  whatsapp: string | null
  photoFileId: string | null
  readonly createdAt: IsoTimestamp
}

/** Server controlled. Owners cannot change suspension state or their role. */
export interface AccountAccess {
  readonly userId: UserId
  readonly status: 'active' | 'suspended'
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly ownerId: UserId
  readonly createdAt: IsoTimestamp
  name: string
  onboarding: 'business-profile' | 'complete'
  timezone: string
  currency: string
}

/** Resolve this from verified server identity, never from a submitted ownerId. */
export interface OwnerContext {
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
}

export interface WorkspaceRecord {
  readonly id: string
  readonly workspaceId: WorkspaceId
  readonly createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}
