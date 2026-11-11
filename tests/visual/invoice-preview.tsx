// Standalone visual fixture. Does not import Firebase or create application records.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { InvoicePreview } from '../../src/features/workspace/invoices/InvoicePreview'
import { defaultAgency, newLine } from '../../src/features/workspace/invoices/model'
import type { InvoiceDraft } from '../../src/features/workspace/invoices/model'
import '../../src/styles.css'
import '../../src/styles/modules.css'
import '../../src/features/workspace/invoices/invoices.css'

const draft: InvoiceDraft = { version:1, agency:{...defaultAgency(),name:'Agency preview',ownerName:'Visual QA fixture',email:'example@example.test',address:'Preview address only',city:'Mumbai',state:'Maharashtra',gstin:'',footer:'Thank you for your business.',brandColor:'#10B981'},client:{name:'Client preview',company:'Visual fixture only',contact:'',email:'client@example.test',phone:'',whatsapp:'',address:'Example billing address',gstin:''},title:'Digital marketing services',date:'2026-11-11',due:'2026-11-25',currency:'INR',priceMode:'exclusive',gstMode:'split',gstEnabled:true,discountKind:'percent',discount:'5',charges:'0',notes:'Please review the scope and amounts before issuance.',terms:'This is a draft for review.',methods:[],lines:[{...newLine('line-one'),name:'Social Media Management',description:'Content planning, creative coordination and monthly reporting.',quantity:'1',rate:'15000',gst:'18'},{...newLine('line-two'),name:'Marketing Consultation',description:'Strategy review and campaign planning.',quantity:'2',unit:'hours',rate:'2000',gst:'18'}] }
createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="agency-invoices" style={{padding:16,maxWidth:1100,margin:'auto'}}><h1>Visual QA fixture — no records saved</h1><button className="small-button" onClick={()=>document.documentElement.classList.toggle("dark")}>Toggle QA theme</button><p className="field-help">On small screens, swipe the A4 preview horizontally to view the complete document.</p><InvoicePreview draft={draft}/></main></React.StrictMode>)
