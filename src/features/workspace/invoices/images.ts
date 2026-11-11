/** Decode and re-encode raster images; SVG and external URLs are never accepted. */
export async function smallPng(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1000000) throw new Error('Choose a PNG or JPEG image smaller than 1 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw new Error('Image dimensions are too large.')
    const ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image preview is unavailable in this browser.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/png')
    if (data.length > 45000) throw new Error('Image is too detailed. Use a simpler image below approximately 32 KB after conversion.')
    return data
  } finally { bitmap.close() }
}
