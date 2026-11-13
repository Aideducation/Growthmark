import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { useAuth } from '../auth/auth-context'
import { friendlyAuthError } from '../auth/auth-api'
import type { Entity, RecordRow, SettingsKind } from './schema'
import { DataContext } from './data-context'

const entities: Entity[] = ['clients', 'projects', 'tasks', 'quotations', 'invoices', 'payments']
const empty = (): Record<Entity, RecordRow[]> => ({ clients: [], projects: [], tasks: [], quotations: [], invoices: [], payments: [] })
export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const uid = session.status === 'ready' ? session.identity.userId : ''
  const [records, setRecords] = useState(empty), [settings, setSettings] = useState<Record<SettingsKind, RecordRow | null>>({ business: null, payment: null, invoice: null })
  const [items, setItems] = useState<Record<string, RecordRow[]>>({})
  const [loaded, setLoaded] = useState<Set<string>>(new Set()), [initialized, setInitialized] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [cap, setCap] = useState(100)
  useEffect(() => {
    if (!uid) return
    let alive = true
    setRecords(empty()); setSettings({ business: null, payment: null, invoice: null }); setItems({}); setLoaded(new Set()); setInitialized(false); setError('')
    const ready = (key: string) => { if (alive) setLoaded(current => new Set([...current, key])) }
    const fail = (issue: unknown) => { if (alive) { setError(friendlyAuthError(issue)); setRecords(empty()); setItems({}) } }
    const stops = entities.map(kind => onSnapshot(query(collection(db, 'workspaces', uid, kind), orderBy('createdAt', 'desc'), limit(cap)), snapshot => {
      if (!alive) return
      setRecords(current => ({ ...current, [kind]: snapshot.docs.map(document => ({ ...document.data(), id: document.id, ...(kind === 'invoices' ? { _pendingWrites: document.metadata.hasPendingWrites } : {}) } as RecordRow)) })); ready(kind)
    }, fail))
    for (const kind of ['business', 'payment', 'invoice'] as const) stops.push(onSnapshot(doc(db, 'workspaces', uid, 'settings', kind), snapshot => {
      if (!alive) return
      setSettings(current => ({ ...current, [kind]: snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as RecordRow : null })); ready(`settings/${kind}`)
    }, fail))
    return () => { alive = false; stops.forEach(stop => stop()) }
  }, [uid, refresh, cap])
  const draftKeys = [...records.quotations.map(row => `quotations/${row.id}`), ...records.invoices.map(row => `invoices/${row.id}`)].sort().join('|')
  useEffect(() => {
    if (!uid) return
    let alive = true
    const keys = draftKeys ? draftKeys.split('|') : []
    setItems(current => Object.fromEntries(Object.entries(current).filter(([key]) => keys.includes(key))))
    const stops = keys.map(key => onSnapshot(query(collection(db, 'workspaces', uid, ...key.split('/'), 'items'), orderBy('createdAt'), limit(101)), snapshot => {
      if (alive) setItems(current => ({ ...current, [key]: snapshot.docs.map(document => ({ ...document.data(), id: document.id } as RecordRow)) }))
    }, issue => { if (alive) setError(friendlyAuthError(issue)) }))
    return () => { alive = false; stops.forEach(stop => stop()) }
  }, [uid, draftKeys, refresh, cap])
  const itemKeys = draftKeys ? draftKeys.split('|') : []
  useEffect(() => { if (loaded.size === 9 && itemKeys.every(key => key in items)) setInitialized(true) }, [loaded, items, draftKeys])
  const loading = !initialized
  const capped = entities.some(kind => records[kind].length >= cap) || Object.values(items).some(lines => lines.length >= 101)
  return <DataContext.Provider value={{ records, settings, items, loading, error, capped, cap, retry: () => setRefresh(value => value + 1), loadMore: () => setCap(value => value + 100) }}>{children}</DataContext.Provider>
}
