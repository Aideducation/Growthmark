import { jsPDF } from 'jspdf'
import { calculateInvoice, validateDraft } from './model.ts'
import type { InvoiceDraft } from './model.ts'

export async function createInvoicePdf(input: InvoiceDraft, embeddedFont?: string): Promise<Uint8Array> {
  const draft = validateDraft(input), totals = calculateInvoice(draft), a = draft.agency
  let font = embeddedFont
  if (!font) { const response = await fetch('/fonts/NotoSans-Regular.ttf'); if (!response.ok) throw new Error('PDF font unavailable.'); const bytes = new Uint8Array(await response.arrayBuffer()); let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte); font=btoa(binary) }
  const pdf = new jsPDF({unit:'mm',format:'a4'}); pdf.addFileToVFS('NotoSans.ttf',font);pdf.addFont('NotoSans.ttf','NotoSans','normal');pdf.setFont('NotoSans');pdf.setProperties({title:`Draft invoice — ${draft.title}`,subject:'DRAFT - NOT ISSUED',creator:'GrowthMark'})
  const brand = a.brandColor.match(/[0-9a-f]{2}/gi)!.map(value=>parseInt(value,16)) as [number,number,number]
  const amount = (minor:number)=>`${draft.currency} ${(minor/100).toFixed(2)}`
  let y=22
  function page(height=8){if(y+height>274){pdf.addPage();y=22}}
  function text(value:string,size=10,width=170,x=20){pdf.setFontSize(size);pdf.setTextColor(23,28,27);for(const line of pdf.splitTextToSize(value||' ',width) as string[]){page();pdf.text(line,x,y);y+=size>16?10:6}}
  function image(value:string,x:number,width:number,height:number){if(!value)return;page(height+5);const info=pdf.getImageProperties(value);const scale=Math.min(width/info.width,height/info.height);pdf.addImage(value,'PNG',x,y,info.width*scale,info.height*scale);y+=height+5}
  image(a.logo,20,45,22);text(a.name,22);text('DRAFT INVOICE',15);text('Not issued · no official invoice number · no verified payment status',9)
  text(draft.title,13);text(`Invoice date: ${draft.date}    Due date: ${draft.due||'Not set'}`)
  text([a.ownerName,a.address,a.city,a.state,a.postalCode,a.country].filter(Boolean).join(', '));text([a.email,a.phone,a.whatsapp,a.website].filter(Boolean).join(' · '))
  if(a.gstin)text(`GSTIN: ${a.gstin}`);if(a.pan)text(`PAN: ${a.pan}`)
  y+=5;text('BILL TO',12);text([draft.client.company,draft.client.name,draft.client.contact].filter(Boolean).join(' · '));text(draft.client.address);text([draft.client.email,draft.client.phone].filter(Boolean).join(' · '));if(draft.client.gstin)text(`GSTIN: ${draft.client.gstin}`)
  function header(){page(20);pdf.setFillColor(23,28,27);pdf.rect(20,y,170,10,'F');pdf.setTextColor(255,255,255);pdf.setFontSize(9);pdf.text('SERVICE / DESCRIPTION',23,y+7);pdf.text('QTY / UNIT',104,y+7);pdf.text('DRAFT TOTAL',187,y+7,{align:'right'});y+=17}
  header()
  draft.lines.forEach((line,index)=>{if(y>237){pdf.addPage();y=22;header()}const start=y;text(`${line.quantity} ${line.unit}`,9,30,104);y=start;pdf.setFontSize(9);pdf.text(amount(totals.lines[index].total),187,y,{align:'right'});y=start;text(`${index+1}. ${line.name}`,10,77,23);text(line.description,9,77,23);text(`Rate ${draft.currency} ${line.rate} · Discount ${line.discount}${line.discountKind==='percent'?'%':` ${draft.currency}`} · GST ${draft.gstEnabled?line.gst:'0'}%`,8);pdf.setDrawColor(229,231,235);pdf.line(20,y,190,y);y+=7})
  const rows:[string,number][]=[['Subtotal',totals.subtotal],['Item discounts',-totals.itemDiscount],['Overall discount',-totals.overallDiscount],['Taxable value',totals.taxable],...(draft.gstMode==='split'?[['CGST',totals.cgst],['SGST',totals.sgst]] as [string,number][]:[['IGST',totals.igst]] as [string,number][]),['Additional non-taxable charges',totals.charges]]
  page(65);for(const [label,value]of rows)text(`${label}: ${amount(value)}`,10,170,20)
  text(`DRAFT TOTAL: ${amount(totals.total)}`,16);text(`Prices are GST-${draft.priceMode}. Amount paid: not tracked for drafts. Balance: not issued.`,9)
  if(draft.methods.length){y+=5;text('SELECTED PAYMENT METHODS',12);if(draft.methods.includes('upi')){text(`UPI: ${a.upiId} · ${a.upiHolder}`);image(a.qr,20,35,35)}if(draft.methods.includes('bank'))text(`Bank: ${a.bankName} · Branch: ${a.branch}\nAccount holder: ${a.bankHolder}\nAccount: ${a.accountNumber}\nIFSC: ${a.ifsc}`);if(draft.methods.includes('cash'))text('Cash accepted');if(draft.methods.includes('other'))text(a.otherMethod);text(a.instructions)}
  y+=5;text('NOTES AND TERMS',12);text(draft.notes);text(draft.terms);text(a.paymentTerms);image(a.signature,20,45,20);text(a.signatureName);text(a.footer,9)
  for(let i=1;i<=pdf.getNumberOfPages();i++){pdf.setPage(i);pdf.setFillColor(...brand);pdf.rect(0,0,210,4,'F');pdf.setFontSize(8);pdf.setTextColor(107,114,128);pdf.text(`DRAFT — NOT ISSUED · Page ${i} / ${pdf.getNumberOfPages()} · Private owner export`,20,288)}
  return new Uint8Array(pdf.output('arraybuffer'))
}
export async function exportInvoicePdf(draft:InvoiceDraft,print=false){
  // Open synchronously from the click gesture to avoid browser popup blockers during font loading.
  const preview=print?window.open('about:blank','_blank'):null
  try{const bytes=await createInvoicePdf(draft),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));if(print){if(!preview)throw new Error('Allow popups to open the printable PDF.');preview.opener=null;preview.location.href=url}else{const link=document.createElement('a');link.href=url;link.download='GrowthMark-Draft-Invoice.pdf';document.body.append(link);link.click();link.remove()}setTimeout(()=>URL.revokeObjectURL(url),600000)}catch(error){preview?.close();throw error}
}
