import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('growthmark-theme', next ? 'dark' : 'light') } catch { /* Theme still works when browser storage is unavailable. */ }
  }
  return <button className="icon-button" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title={`Switch to ${dark ? 'light' : 'dark'} mode`}>
    {dark ? <Sun size={19} /> : <Moon size={19} />}
  </button>
}
