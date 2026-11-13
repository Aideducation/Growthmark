// Server/operator only. Never import from src. No credential discovery or logging.
export function encode(value) {
  if(value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.$timestamp==='string')return {timestampValue:value.$timestamp}
  if(value===null)return {nullValue:null}
  if(typeof value==='string')return {stringValue:value}
  if(typeof value==='boolean')return {booleanValue:value}
  if(typeof value==='number'&&Number.isSafeInteger(value))return {integerValue:String(value)}
  if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}}
  if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}}
  throw new Error('Unsupported database value.')
}
export function decode(value) {
  if('nullValue'in value)return null
  if('stringValue'in value)return value.stringValue
  if('booleanValue'in value)return value.booleanValue
  if('integerValue'in value)return Number(value.integerValue)
  if('doubleValue'in value)return value.doubleValue
  if('timestampValue'in value)return {$timestamp:value.timestampValue}
  if('arrayValue'in value)return (value.arrayValue.values??[]).map(decode)
  if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields??{}).map(([k,v])=>[k,decode(v)]))
  throw new Error('Unsupported database field; inventory requires review.')
}
export function firestoreRest({projectId,accessToken,fetcher=fetch,baseUrl='https://firestore.googleapis.com/v1'}) {
  if(!/^[a-z0-9-]+$/.test(projectId))throw new Error('Invalid project.')
  const database=`projects/${projectId}/databases/(default)`,root=database+'/documents'
  const name=path=>{if(typeof path!=='string'||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid database path.');return root+'/'+path.split('/').map(encodeURIComponent).join('/')}
  async function call(path,method='GET',body) {
    const response=await fetcher(baseUrl+'/'+path,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
    if(response.status===404&&method==='GET')return null
    if(!response.ok)throw Object.assign(new Error('Trusted database request failed ('+response.status+').'),{status:response.status})
    return response.status===204?{}:response.json()
  }
  const store={
    projectId,
    async begin(){return (await call(database+'/documents:beginTransaction','POST',{})).transaction},
    async get(path,transaction){
      let row
      if(transaction){const result=await call(database+'/documents:batchGet','POST',{documents:[decodeURIComponent(name(path))],transaction});row=(Array.isArray(result)?result:[result]).find(r=>r?.found)?.found}
      else row=await call(name(path))
      return row?{exists:true,data:decode({mapValue:{fields:row.fields??{}}}),updateTime:row.updateTime}:{exists:false}
    },
    async list(path,transaction){const rows=[];let token;do{const response=await call(name(path)+'?pageSize=100&showMissing=true'+(transaction?'&transaction='+encodeURIComponent(transaction):'')+(token?'&pageToken='+encodeURIComponent(token):''));for(const row of response?.documents??[])rows.push({id:row.name.split('/').at(-1),data:decode({mapValue:{fields:row.fields??{}}}),updateTime:row.updateTime,missing:!row.updateTime});token=response?.nextPageToken;if(rows.length>10000)throw new Error('Inventory exceeds automatic review limit.')}while(token);return rows},
    async commit(writes,transaction){return call(database+'/documents:commit','POST',{writes:writes.map(w=>w.verify?{verify:decodeURIComponent(name(w.path)),currentDocument:w.updateTime?{updateTime:w.updateTime}:{exists:false}}:w.delete?{delete:decodeURIComponent(name(w.path)),currentDocument:{updateTime:w.updateTime}}:{update:{name:decodeURIComponent(name(w.path)),fields:encode(w.data).mapValue.fields},currentDocument:w.updateTime?{updateTime:w.updateTime}:{exists:false},...(w.timestamps?.length?{updateTransforms:w.timestamps.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})}),...(transaction?{transaction}:{})})},
    async rollback(transaction){await call(database+'/documents:rollback','POST',{transaction})},
  }
  return store
}
