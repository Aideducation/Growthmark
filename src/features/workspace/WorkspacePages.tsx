import { useEffect } from 'react'
import { usePage, navigation } from '../../app/navigation'
import { DashboardPage } from '../dashboard/DashboardPage'
import { PageHeader } from '../../components/PageHeader'
import { useWorkspaceData } from './data-context'
import { RecordPage } from './RecordPage'
import { InvoicePage } from './invoices/InvoicePage'
import { BusinessPage, SettingsPage } from './SettingsPages'
import { ReportsPage } from './ReportsPage'
import { RetainersPage } from './RetainersPage'
import type { Entity } from './schema'

export function WorkspacePages() {
  const page = usePage()
  const data = useWorkspaceData()
  useEffect(() => { if (location.hash !== '#setup') window.scrollTo({ top: 0 }); document.querySelector<HTMLElement>('main')?.focus() }, [page.id])
  if (data.error) return <main tabIndex={-1}><PageHeader title={page.title} description="Workspace records could not be loaded."/><p className="auth-error" role="alert">{data.error}</p><button className="secondary-button" onClick={data.retry}>Retry loading records</button></main>
  if (data.loading) return <main tabIndex={-1}><PageHeader title={page.title} description="Loading your private workspace records…"/><p role="status" className="info-banner">Checking your records. Figures will appear only after the database responds.</p></main>
  const notice = data.capped ? <div className="data-limit-notice" role="status">Display limit reached. Totals cover loaded records and line items only. <button className="small-button" onClick={data.loadMore}>Load more records</button></div> : null
  return <>{notice}<ModulePage key={page.id} id={page.id} title={page.title}/></>
}
function ModulePage({ id, title }: { id: string; title: string }) {
  const page = { id, title }
  if (page.id === 'dashboard') return <DashboardPage/>
  if (page.id === 'invoices') return <InvoicePage/>
  if (['clients', 'projects', 'tasks', 'quotations', 'invoices', 'payments'].includes(page.id)) return <RecordPage kind={page.id as Entity}/>
  if (page.id === 'business') return <BusinessPage/>
  if (page.id === 'settings') return <SettingsPage/>
  if (page.id === 'reports') return <ReportsPage/>
  if (page.id === 'retainers') return <RetainersPage/>
  const known = navigation.some(item => item.id === page.id)
  return <main id="workspace-content" key={page.id}><PageHeader title={page.title} description={known ? 'Your private workspace. This module is being connected securely.' : 'This workspace page does not exist.'}/><section className="panel"><h2>{known ? 'Integration in progress' : 'Choose a page from the sidebar'}</h2><p className="subtitle">{known ? 'No sample business records are shown. Available actions will appear as each module is connected.' : 'Your records have not changed.'}</p></section></main>
}
