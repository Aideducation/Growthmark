import { createContext, useContext } from 'react'
import type { Entity, RecordRow, SettingsKind } from './schema'

export interface WorkspaceData {
  records: Record<Entity, RecordRow[]>
  settings: Record<SettingsKind, RecordRow | null>
  items: Record<string, RecordRow[]>
  loading: boolean
  error: string
  capped: boolean
  cap: number
  retry: () => void
  loadMore: () => void
}
export const DataContext = createContext<WorkspaceData | null>(null)
export function useWorkspaceData() { const value = useContext(DataContext); if (!value) throw new Error('Workspace data context is unavailable.'); return value }
