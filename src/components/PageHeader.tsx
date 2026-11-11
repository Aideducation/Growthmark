import type { ReactNode } from 'react'
export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading module-heading"><div><p className="eyebrow">YOUR BUSINESS, IN FOCUS</p><h1>{title}<span className="heading-dot">.</span></h1><p className="subtitle">{description}</p></div>{action}</div>
}
