import { createContext, useContext } from 'react'
import type { SessionState } from './contracts'

export interface AuthContextValue {
  session: SessionState
  refreshSession: () => void
  signOut: () => Promise<void>
}
export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('Authentication context is unavailable.')
  return value
}
