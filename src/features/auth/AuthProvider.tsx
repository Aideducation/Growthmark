import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, authPersistenceReady, db } from '../../services/firebase'
import type { AuthenticatedIdentity, SessionState } from './contracts'
import { friendlyAuthError, logout } from './auth-api'
import { readOwnerWorkspace } from './workspace-service'
import { AuthContext } from './auth-context'

function identity(user: User): AuthenticatedIdentity {
  return { userId: user.uid, email: user.email, emailVerified: user.emailVerified, displayName: user.displayName }
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true, generation = 0
    let stopAuth = () => {}, stopAccess = () => {}
    function fail(error: unknown) {
      if (active) setSession({ status: 'error', message: friendlyAuthError(error) })
    }
    async function inspect(user: User | null) {
      const request = ++generation
      stopAccess()
      setSession({ status: 'loading' })
      if (!user) { setSession({ status: 'signed-out' }); return }
      if (!user.emailVerified) { setSession({ status: 'verification-required', identity: identity(user) }); return }
      let snapshotGeneration = 0
      stopAccess = onSnapshot(doc(db, 'accountAccess', user.uid), async snapshot => {
        const snapshotRequest = ++snapshotGeneration
        if (!active || request !== generation) return
        if (snapshot.exists() && (snapshot.data().userId !== user.uid || snapshot.data().status !== 'active')) {
          setSession({ status: 'suspended' }); return
        }
        try {
          const records = await readOwnerWorkspace(auth, db)
          if (!active || request !== generation || snapshotRequest !== snapshotGeneration || auth.currentUser?.uid !== user.uid) return
          setSession(records?.workspace.onboarding === 'complete'
            ? { status: 'ready', identity: identity(user), ...records }
            : { status: 'onboarding', identity: identity(user) })
        } catch (error) {
          if (active && request === generation && snapshotRequest === snapshotGeneration) fail(error)
        }
      }, error => { if (active && request === generation) fail(error) })
    }
    void authPersistenceReady.then(() => {
      if (active) stopAuth = onIdTokenChanged(auth, user => { void inspect(user) }, fail)
    }).catch(fail)
    return () => { active = false; generation++; stopAuth(); stopAccess() }
  }, [refresh])
  async function signOut() {
    setSession({ status: 'loading' })
    try { await logout(auth); setSession({ status: 'signed-out' }) }
    catch (error) { setSession({ status: 'error', message: friendlyAuthError(error) }); throw error }
  }
  return <AuthContext.Provider value={{ session, refreshSession: () => setRefresh(value => value + 1), signOut }}>{children}</AuthContext.Provider>
}
