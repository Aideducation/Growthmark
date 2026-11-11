import { ArrowUpRight, ChartNoAxesCombined, Check, Layers3, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useWorkspaceData } from '../workspace/data-context'
import { calculateDocument, money } from '../workspace/money'
import { dateValue, str } from '../workspace/schema'
import { paymentDay, paymentSum, today } from '../workspace/analysis'
import { CollectionChart } from '../workspace/ReportsPage'

export function DashboardPage() {
  const { records, items } = useWorkspaceData(), { session } = useAuth()
  const currency = session.status === 'ready' ? session.workspace.currency : 'INR'
  const timezone = session.status === 'ready' ? session.workspace.timezone : 'UTC'
  const currentDay = today(timezone)
  const monthPayments = records.payments.filter(row => paymentDay(row, timezone).startsWith(currentDay.slice(0, 7)))
  const upcoming = records.tasks.filter(row => !['completed', 'cancelled'].includes(str(row, 'status')) && dateValue(row.dueAt)).sort((a,b) => dateValue(a.dueAt).localeCompare(dateValue(b.dueAt))).slice(0, 6)
  const estimates = records.invoices.filter(row => row.state === 'draft').reduce((sum,row) => sum + calculateDocument(items['invoices/'+row.id] ?? []).total, 0)
  const stats = [
    { title: 'Monthly collections', value: money(paymentSum(monthPayments), currency), note: 'Owner-recorded · Not independently verified' },
    { title: 'All recorded collections', value: money(paymentSum(records.payments), currency), note: 'Actual entries in loaded payment history' },
    { title: 'Invoice draft estimates', value: money(estimates, currency), note: 'Drafts only · Not issued revenue' },
    { title: 'Active clients', value: records.clients.filter(row=>row.status==='active').length, note: records.clients.length+' clients in your loaded records' },
    { title: 'Active projects', value: records.projects.filter(row=>row.status==='active').length, note: records.projects.length+' projects in your loaded records' },
    { title: 'Issued revenue / outstanding', value: 'Pending', note: 'Issuance and overdue invoice accounting need the backend' },
  ]
  return <main id="dashboard" tabIndex={-1}>
    <div className="page-heading"><div><p className="eyebrow">YOUR BUSINESS, IN FOCUS</p><h1>Workspace overview<span className="heading-dot">.</span></h1><p className="subtitle">Your clients, work and collections, in one clear view.</p></div><span className="status-pill"><span/> Private workspace</span></div>
        <section className="welcome-card" aria-labelledby="welcome-title"><div className="welcome-copy"><span className="welcome-label"><Sparkles size={14}/> MADE FOR YOUR NEXT CHAPTER</span><h2 id="welcome-title">Good work starts with<br/>a little clarity.</h2><p>Bring your business’s work together in one calm, organized space. Your GrowthMark workspace starts here.</p><a className="primary-button" href="#clients">Manage your clients <ArrowUpRight size={17}/></a></div><div className="welcome-art" aria-hidden="true"><div className="art-ring ring-one"/><div className="art-ring ring-two"/><div className="art-tile tile-back"><Layers3 size={36}/></div><div className="art-tile tile-front"><ChartNoAxesCombined size={62} strokeWidth={1.5}/><span className="art-line"/><span className="art-line short"/></div><span className="art-badge"><Check size={18}/></span><span className="art-spark">✦</span></div></section>

    <div className="section-heading"><h2>Your business at a glance</h2><span>Actual loaded workspace records</span></div>
    <section className="stats-grid dashboard-stats">{stats.map(stat=><article className="stat-card" key={stat.title}><div className="stat-top">{stat.title}</div><h3>{stat.value}</h3><p>{stat.note}</p></article>)}</section>
    <CollectionChart compact/>
    <div className="bottom-grid" id="setup"><section className="panel module-panel"><div className="detail-heading"><h2>Upcoming and overdue tasks</h2><a className="small-button" href="#tasks">All tasks</a></div>{!upcoming.length?<div className="empty-state">No open tasks with due dates.</div>:upcoming.map(row=><a className="activity-row" key={row.id} href="#tasks"><span><strong>{str(row,'title')}</strong><small>{str(row,'priority')} priority</small></span><span className={dateValue(row.dueAt)<currentDay?'overdue-text':''}>{dateValue(row.dueAt)}{dateValue(row.dueAt)<currentDay?' · Overdue':''}</span></a>)}</section><section className="panel module-panel"><div className="detail-heading"><h2>Recent collections</h2><a href="#payments" className="small-button">All payments</a></div>{!records.payments.length?<div className="empty-state">No payments recorded yet.</div>:records.payments.slice(0,5).map(row=><div className="activity-row" key={row.id}><span><strong>{str(records.clients.find(client=>client.id===row.clientId),'name')||'Linked client'}</strong><small>{paymentDay(row,timezone)} · Owner recorded</small></span><strong>{money(Number(row.amountMinor),currency)}</strong></div>)}</section></div>
    <footer className="page-footer"><span>GrowthMark</span><span>Less clutter. More momentum.</span></footer>
  </main>
}
