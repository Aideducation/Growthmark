import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose); close.current = onClose
  const busyRef = useRef(busy); busyRef.current = busy
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement as HTMLElement | null
    element?.showModal()
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const cancel = (event: Event) => { event.preventDefault(); if (!busyRef.current) close.current() }
    element?.addEventListener('cancel', cancel)
    return () => { element?.removeEventListener('cancel', cancel); element?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <dialog ref={dialog} className="dialog-surface module-dialog" aria-labelledby="dialog-title"><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18}/></button></div>{children}</dialog>
}
