// Test-only execution of existing presentation code; no application adapters.
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export async function importPreview() {
  const file = resolve('src/features/workspace/invoices/InvoicePreview.tsx')
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  code = code.replace(/from ["']([^"']+)["']/g, (_, name) => {
    const url = name.startsWith('.') ? pathToFileURL(resolve(dirname(file), name + (name.endsWith('.ts') ? '' : '.ts'))).href : import.meta.resolve(name)
    return `from ${JSON.stringify(url)}`
  })
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}

export async function existingWhatsAppHandlers() {
  const text = await readFile('src/features/workspace/invoices/InvoicePage.tsx', 'utf8')
  const source = ts.createSourceFile('InvoicePage.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let message, open
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'whatsapp') message = node.getText(source)
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick' && node.initializer && ts.isJsxExpression(node.initializer)) {
      const value = node.initializer.expression
      if (value && ts.isArrowFunction(value) && value.getText(source).includes('https://wa.me/')) open = value.getText(source)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  if (!message || !open) throw new Error('Existing WhatsApp handlers could not be located; update the test harness explicitly.')
  const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return {
    message: new Function('editor', 'calculateInvoice', 'money', 'setShare', 'setError', 'reference', compile(message) + '\nreturn whatsapp();'),
    open: new Function('editor', 'share', 'setError', 'window', compile(`const action = ${open};`) + '\nreturn action();'),
  }
}
