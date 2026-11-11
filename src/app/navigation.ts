import { useSyncExternalStore } from 'react'
import { BarChart3, BriefcaseBusiness, Building2, CalendarClock, CheckSquare, CreditCard, FileText, LayoutDashboard, Receipt, Settings, Users } from 'lucide-react'

export const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'quotations', label: 'Quotations', icon: FileText },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'retainers', label: 'Retainers', icon: CalendarClock },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'business', label: 'Business Profile', icon: Building2 },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const
export type PageId = typeof navigation[number]['id']
function subscribe(listener: () => void) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }
export function usePage() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '#dashboard')
  const value = hash.slice(1).split('?')[0] || 'dashboard'
  const id = value === 'setup' ? 'dashboard' : value
  return { id, title: navigation.find(page => page.id === id)?.label ?? 'Page not found' }
}
