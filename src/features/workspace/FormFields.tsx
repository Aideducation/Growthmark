import type { Field, InputValues, RecordRow } from './schema'
import { label, str } from './schema'
import { useWorkspaceData } from './data-context'

export function FormFields({ fields, values, setValues, editing = false }: { fields: Field[]; values: InputValues; setValues: (value: InputValues) => void; editing?: boolean }) {
  const { records } = useWorkspaceData()
  return <div className="form-grid">{fields.map(field => {
    const value = values[field.key] ?? '', disabled = Boolean(editing && field.immutable)
    const update = (next: string) => setValues({ ...values, [field.key]: next, ...(field.key === 'clientId' && fields.some(item => item.key === 'projectId') ? { projectId: '' } : {}) })
    const options: RecordRow[] = field.type === 'client' ? records.clients : field.type === 'project' ? records.projects.filter(row => row.clientId === values.clientId) : []
    return <label className={`field ${field.type === 'textarea' ? 'span-two' : ''}`} key={field.key}>{field.label}{field.required && <span className="field-required">Required</span>}
      {field.type === 'select' || field.type === 'client' || field.type === 'project' ? <select className="field-input" value={value} onChange={event => update(event.target.value)} required={field.required} disabled={disabled}>
        {field.type !== 'select' && <option value="">{field.required ? 'Select…' : 'None'}</option>}
        {field.type === 'select' ? field.options?.map(option => <option key={option} value={option}>{label(option)}</option>) : options.map(row => <option key={row.id} value={row.id}>{str(row, 'name')}{str(row, 'status') === 'archived' ? ' (archived)' : ''}</option>)}
        {value && field.type !== 'select' && !options.some(row => row.id === value) && <option value={value}>Linked record (load more to view)</option>}
      </select> : field.type === 'textarea' ? <textarea className="field-input" rows={3} maxLength={field.max} value={value} onChange={event => update(event.target.value)} required={field.required}/> : <input className="field-input" type={field.type === 'money' ? 'number' : field.type ?? 'text'} step={field.type === 'money' ? '0.01' : field.type === 'number' ? '1' : undefined} min={field.min} max={field.type === 'number' || field.type === 'money' ? field.max : undefined} maxLength={field.type !== 'number' && field.type !== 'money' ? field.max : undefined} value={value} onInput={event => { if (field.type === 'date' || field.type === 'datetime-local') update(event.currentTarget.value) }} onChange={event => update(event.target.value)} required={field.required} disabled={disabled}/>}
      {disabled && <span className="field-help">This relationship is fixed to preserve history.</span>}{field.hint && <span className="field-help">{field.hint}</span>}
    </label>
  })}</div>
}
