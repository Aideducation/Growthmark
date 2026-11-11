import { ChartNoAxesCombined, ChevronRight, Layers3, LogOut, Menu, PanelLeftClose, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeToggle } from '../../components/ThemeToggle'
import { useAuth } from '../../features/auth/auth-context'
import { navigation, usePage } from '../navigation'

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const page = usePage()
  const businessName = session.status === 'ready' ? session.workspace.name : 'Your workspace'
  const ownerName = session.status === 'ready' ? session.profile.fullName : ''
  const initials = ownerName.split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join('').toUpperCase()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    function updateLayout() {
      setMobile(media.matches)
      setMenuOpen(false)
    }
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
      if (event.key !== 'Tab') return
      const controls = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      menuButton.current?.focus()
    }
  }, [menuOpen])
  return <div className="app-shell">
    <button className="skip-link" onClick={() => document.querySelector<HTMLElement>('main')?.focus()}>Skip to content</button>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebar} inert={mobile && !menuOpen} id="workspace-navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
      <a className="brand" href="#dashboard" onClick={() => setMenuOpen(false)}><span className="brand-icon"><ChartNoAxesCombined size={23}/></span><span>GrowthMark<span className="brand-subtitle">FREELANCER WORKSPACE</span></span></a>
      <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={20}/></button>
      <div className="workspace-picker"><span className="workspace-avatar">G</span><div><strong title={businessName}>{businessName}</strong><small>Your private workspace</small></div><Layers3 size={16}/></div>
      <p className="nav-label">WORKSPACE</p>
      <nav className="workspace-nav" aria-label="Workspace pages">{navigation.map(({id,label,icon:Icon}) => <a key={id} className={`nav-item ${page.id === id ? 'active' : ''}`} href={`#${id}`} aria-current={page.id === id ? 'page' : undefined} onClick={() => setMenuOpen(false)}><Icon size={18}/>{label}{page.id === id && <span className="active-dot"/>}</a>)}</nav>
      <div className="sidebar-note compact-note"><span className="note-icon"><Sparkles size={16}/></span><strong>Your business, organized.</strong><p>Private workspace · Local development</p></div>
      <div className="sidebar-footer"><span className="workspace-avatar">GM</span><div><strong title={ownerName}>{ownerName}</strong><small>Workspace owner</small></div><PanelLeftClose size={17}/></div>
    </aside>
    <div className="main-shell">
      <header className="header"><div className="header-location"><button ref={menuButton} aria-controls="workspace-navigation" className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21}/></button><span className="breadcrumb account-label" title={businessName}>{businessName}</span><ChevronRight size={14}/><strong>{page.title}</strong></div><div className="header-actions"><span className="environment"><span/> Local workspace</span><ThemeToggle/><span className="header-divider"/><span className="profile-avatar" aria-label={ownerName} title={ownerName}>{initials}</span><button type="button" className="icon-button header-logout" aria-label="Sign out" onClick={() => { void signOut().catch(() => {}) }}><LogOut size={17}/><span>Sign out</span></button></div></header>
      {children}

    </div>
  </div>
}
