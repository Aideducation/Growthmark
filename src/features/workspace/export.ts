export function csvText(rows: Record<string, string | number>[]) {
  if (!rows.length) return ''
  const escape = (value: unknown) => { let text = String(value ?? ''); if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"` }
  const columns = Object.keys(rows[0])
  return '\uFEFF' + [columns.map(escape).join(','), ...rows.map(row => columns.map(key => escape(row[key])).join(','))].join('\r\n')
}
export function exportCsv(title: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return
  const csv = csvText(rows)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `growthmark-${title.toLowerCase().replaceAll(' ', '-')}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
