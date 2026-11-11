/** Exact decimal parsing and round-half-up arithmetic. Draft estimates only. */
export function scaledInteger(value: string, digits = 2): number {
  const clean = value.trim()
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`)
  if (!pattern.test(clean)) throw new Error(`Enter a non-negative number with at most ${digits} decimal places.`)
  const [whole, fraction = ''] = clean.split('.')
  const result = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'))
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large.')
  return Number(result)
}
function rounded(numerator: bigint, denominator: bigint) { return (numerator + denominator / 2n) / denominator }
export interface LineAmounts { [key: string]: unknown; description?: unknown; quantityMilli?: unknown; unitPriceMinor?: unknown; taxRateBps?: unknown; discountBps?: unknown }
export function calculateLine(line: LineAmounts) {
  const values = [line.quantityMilli, line.unitPriceMinor, line.taxRateBps, line.discountBps]
  if (!values.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('A line item contains invalid amounts.')
  const [quantity, price, taxRate, discountRate] = values as number[]
  if (quantity < 1 || taxRate > 10000 || discountRate > 10000) throw new Error('A line item is outside its supported range.')
  const subtotal = rounded(BigInt(quantity) * BigInt(price), 1000n)
  const discount = rounded(subtotal * BigInt(discountRate), 10000n)
  const tax = rounded((subtotal - discount) * BigInt(taxRate), 10000n)
  const total = subtotal - discount + tax
  if ([subtotal, discount, tax, total].some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('Document amount is too large to display safely.')
  return { subtotal: Number(subtotal), discount: Number(discount), tax: Number(tax), total: Number(total) }
}
export function calculateDocument(lines: LineAmounts[]) {
  const result = lines.reduce<{ subtotal: number; discount: number; tax: number; total: number }>((sum, line) => {
    const value = calculateLine(line)
    return { subtotal: sum.subtotal + value.subtotal, discount: sum.discount + value.discount, tax: sum.tax + value.tax, total: sum.total + value.total }
  }, { subtotal: 0, discount: 0, tax: 0, total: 0 })
  if (!Object.values(result).every(Number.isSafeInteger)) throw new Error('Document amount is too large.')
  return result
}
export function money(minor: number, currency: string) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100) }
