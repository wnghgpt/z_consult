import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import CloudPanel from './features/CloudPanel.jsx';
import ConsultationTable from './features/ConsultationTable.jsx';
import {fileHash,connectionError} from './lib/staging.js';
import {supabase} from './lib/supabase.js';

const reviewLabels={new:'신규',update:'업데이트',same:'기존 동일',duplicate:'중복 의심',issue:'확인 필요'};
const reviewOrder=['new','update','same','duplicate','issue'];
const autoExcluded=new Set(['same','duplicate','issue']);
const clean=value=>String(value??'').trim();
const normalized=value=>clean(value).replace(/\s+/g,' ');
const compactDate=value=>clean(value).slice(0,10);
const itemKey=value=>normalized(Array.isArray(value)?value.join(','):value).toLowerCase();
function recordKey(record){
 const external=clean(record.externalId||record.fields?.['번호']||record.fields?.['고객번호']);
 const date=compactDate(record.consultation?.date||record.consultation?.date1||record.fields?.['상담일1']||record.fields?.['상담일']);
 const item=itemKey(record.consultation?.item||record.consultation?.items?.join(',')||record.fields?.['상담항목']);
 return external&&date&&item?`${external}|${date}|${item}`:'';
}
function rowKey(row){
 const external=clean(row.external_id||row.source_snapshot?.fields?.['No.']||row.source_snapshot?.fields?.['번호']);
 const date=compactDate(row.consultation_date||row.source_snapshot?.consultation?.date||row.source_snapshot?.fields?.['상담일1']||row.source_snapshot?.fields?.['상담일']);
 const item=itemKey(row.consultation_item||row.source_snapshot?.consultation?.item||row.source_snapshot?.fields?.['상담항목']);
 return external&&date&&item?`${external}|${date}|${item}`:'';
}
function recordSignature(record){
 return JSON.stringify({
  externalId:clean(record.externalId),
  name:normalized(record.name),
  notes:normalized(record.notes),
  content:normalized(record.content),
  consultation:{
   date:compactDate(record.consultation?.date||record.consultation?.date1),
   status:normalized(record.consultation?.status||record.consultation?.status1),
   counselor:normalized(record.consultation?.counselor),
   doctor:normalized(record.consultation?.doctor),
   items:[...(record.consultation?.items??[])].map(itemKey).filter(Boolean).sort(),
  },
  procedures:[...(record.procedures??[])].map(p=>({
   kind:clean(p.kind),date:compactDate(p.date||p.date1),status:normalized(p.status||p.status1),items:[...(p.items??[])].map(itemKey).filter(Boolean).sort(),
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'ko')),
 });
}
function rowSignature(row){
 if(row.source_snapshot)return recordSignature(row.source_snapshot);
 return JSON.stringify({
  externalId:clean(row.external_id),name:normalized(row.patient_name),notes:normalized(row.patient_notes),content:normalized(row.consultation_notes),
  consultation:{date:compactDate(row.consultation_date),status:normalized(row.consultation_status),counselor:normalized(row.counselor),doctor:normalized(row.doctor),items:String(row.consultation_item??'').split(',').map(itemKey).filter(Boolean).sort()},
  procedures:[{kind:'',date:compactDate(row.procedure_date),status:normalized(row.procedure_status),items:String(row.procedure_item??'').split(/\n+/).map(itemKey).filter(Boolean).sort()}],
 });
}
function rowFields(row){
 const source=row.source_snapshot;
 return {
  externalId:clean(row.external_id||source?.externalId),
  name:clean(row.patient_name||source?.name),
  date:compactDate(row.consultation_date||source?.consultation?.date),
  item:clean(row.consultation_item||source?.consultation?.item),
  status:clean(row.consultation_status||source?.consultation?.status),
 };
}
function recordFields(record){
 return {
  externalId:clean(record.externalId),
  name:clean(record.name),
  date:compactDate(record.consultation?.date||record.consultation?.date1),
  item:clean(record.consultation?.item||record.consultation?.items?.join(', ')),
  status:clean(record.consultation?.status||record.consultation?.status1),
 };
}
function diffSummary(record,row){
 if(!row)return '기존 자료 없음';
 const next=recordFields(record),prev=rowFields(row),changes=[];
 [['이름','name'],['상담일','date'],['상담항목','item'],['상담상태','status']].forEach(([label,key])=>{if(normalized(next[key])!==normalized(prev[key]))changes.push(`${label}: ${prev[key]||'—'} → ${next[key]||'—'}`);});
 if(recordSignature(record)!==rowSignature(row)&&!changes.length)changes.push('세부 내용 변경');
 return changes.slice(0,3).join(' · ')||'변경 없음';
}
const oplistFileName=/^oplist_(\d{6})~[^/]*\.docx$/i;
function parseOplistFileName(fileName){
 const match=String(fileName??'').match(oplistFileName);
 if(!match)return null;
 const raw=match[1],year=2000+Number(raw.slice(0,2)),month=Number(raw.slice(2,4)),day=Number(raw.slice(4,6));
 const value=new Date(Date.UTC(year,month-1,day));
 if(value.getUTCFullYear()!==year||value.getUTCMonth()!==month-1||value.getUTCDate()!==day)return null;
 return {raw,periodStart:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
}
function isZipContainer(buffer){
 const bytes=new Uint8Array(buffer);
 return bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;
}
function buildReview(records,existingRows){
 const exact=new Map(),byExternal=new Map(),seenUpload=new Set();
 for(const row of existingRows){
  const key=rowKey(row);if(key&&!exact.has(key))exact.set(key,row);
  const external=clean(row.external_id||row.source_snapshot?.fields?.['No.']||row.source_snapshot?.fields?.['번호']);if(external){const group=byExternal.get(external)??[];group.push(row);byExternal.set(external,group);}
 }
 return records.map(record=>{
  const key=recordKey(record),existing=key?exact.get(key):null,uploadDuplicate=key&&seenUpload.has(key);
  if(key)seenUpload.add(key);
  let status='new',reason='새 상담으로 보입니다.';
  if(record.issues?.length){status='issue';reason=record.issues.join(', ');}
  else if(!key){status='issue';reason='고객번호·상담일·상담항목 중 비교 키가 부족합니다.';}
  else if(uploadDuplicate){status='duplicate';reason='이번 업로드 파일 안에 같은 고객번호·상담일·상담항목이 반복됩니다.';}
  else if(existing){
   if(recordSignature(record)===rowSignature(existing)){status='same';reason='기존 DB 자료와 같은 상담이며 주요 내용도 같습니다.';}
   else {status='update';reason=diffSummary(record,existing);}
  }else{
   const similar=(byExternal.get(clean(record.externalId))??[]).find(row=>{
    const prev=rowFields(row),next=recordFields(record);
    return prev.date===next.date || itemKey(prev.item)===itemKey(next.item);
   });
   if(similar){status='duplicate';reason=`같은 고객번호의 유사 상담이 있습니다. ${diffSummary(record,similar)}`;return {record,status,reason,existing:similar,key:record.key};}
  }
  return {record,status,reason,existing,key:record.key};
 });
}

function App(){
 const [sheets,setSheets]=useState([]),[sheetIndex,setSheetIndex]=useState(0),[fileName,setFileName]=useState(''),[fileKind,setFileKind]=useState('');
 const [docxInfo,setDocxInfo]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(null);
 const [hash,setHash]=useState(''),[refreshKey,setRefreshKey]=useState(0),[tab,setTab]=useState('data');
 const [existingRows,setExistingRows]=useState([]),[reviewBusy,setReviewBusy]=useState(false),[reviewMessage,setReviewMessage]=useState(''),[reviewFilter,setReviewFilter]=useState('all'),[excluded,setExcluded]=useState(()=>new Set());
 const sheet=sheets[sheetIndex], all=sheet?.records??[];
 const review=useMemo(()=>buildReview(all,existingRows),[all,existingRows]);
 const reviewCounts=useMemo(()=>Object.fromEntries(reviewOrder.map(key=>[key,review.filter(r=>r.status===key).length])),[review]);
 const appliedRecords=useMemo(()=>all.filter(record=>!excluded.has(record.key)),[all,excluded]);
 const reviewedSheet=sheet?{...sheet,records:appliedRecords}:sheet;
 const reviewRows=review.filter(row=>reviewFilter==='all'||row.status===reviewFilter);
 const appliedCount=appliedRecords.length;
 const excludedCount=all.length-appliedCount;
 const resetUpload=()=>{setSheets([]);setFileName('');setFileKind('');setDocxInfo(null);setSelected(null);setError('');setExistingRows([]);setReviewMessage('');setReviewFilter('all');setExcluded(new Set());};
 async function upload(file){
  if(!file||busy)return;
  setError('');setSelected(null);setSheets([]);setFileName('');setFileKind('');setDocxInfo(null);setHash('');setExistingRows([]);setReviewMessage('');setReviewFilter('all');setExcluded(new Set());
  const name=file.name.toLowerCase();
  const isXlsx=name.endsWith('.xlsx'),isDocx=name.endsWith('.docx');
  if(!isXlsx&&!isDocx){setError('.xlsx 또는 oplist_YYMMDD~.docx 파일만 지원합니다.');return;}
  if(file.size>20*1024*1024){setError('첫 버전은 20MB 이하 파일을 지원합니다.');return;}
  setBusy(true);
  try{
   const buffer=await file.arrayBuffer();
   if(isDocx){
    const parsedName=parseOplistFileName(file.name);
    if(!parsedName)throw new Error('Word 파일명은 oplist_YYMMDD~.docx 형식이어야 하며 날짜가 유효해야 합니다.');
    if(!isZipContainer(buffer))throw new Error('정상적인 DOCX 압축 파일이 아닙니다. Word에서 다시 저장해 주세요.');
    setFileName(file.name);setFileKind('docx');setHash(await fileHash(buffer));setDocxInfo({periodStart:parsedName.periodStart,size:file.size});
    setReviewMessage('Word 파일 형식 확인 완료. 다음 단계에서 사진·특이사항을 추출합니다.');
    return;
   }
   const {readWorkbook}=await import('./lib/workbook.js');
   const result=await readWorkbook(buffer);
   setHash(await fileHash(buffer));
   if(!result.length)throw new Error('시트가 없습니다.');
   setSheets(result);
   setSheetIndex(Math.max(0,result.findIndex(s=>!s.error)));
   setFileName(file.name);setFileKind('xlsx');
  }catch(e){setError(`${isDocx?'Word 파일을 확인하지 못했습니다.':'엑셀 파일을 읽지 못했습니다. 암호화되지 않은 정상 XLSX인지 확인해 주세요.'} ${e.message}`);}
  finally{setBusy(false);}
 }
 useEffect(()=>{
  setReviewFilter('all');
  setExcluded(new Set(review.filter(item=>autoExcluded.has(item.status)).map(item=>item.record.key)));
 },[sheetIndex,review.map(item=>`${item.record.key}:${item.status}`).join('|')]);
 useEffect(()=>{
  let active=true;
  if(!sheet?.records?.length||!supabase){setExistingRows([]);return ()=>{active=false;};}
  setReviewBusy(true);setReviewMessage('기존 DB 자료와 비교 중입니다.');
  (async()=>{
   try{
    const {data,error}=await supabase.rpc('list_consultation_rows');
    if(error)throw error;
    if(active){setExistingRows(data??[]);setReviewMessage('기존 DB 비교 완료');}
   }catch(e){if(active){setExistingRows([]);setReviewMessage(connectionError(e));}}
   finally{if(active)setReviewBusy(false);}
  })();
  return ()=>{active=false;};
 },[sheet?.name,hash]);
 const setApplied=(recordKey,apply)=>setExcluded(prev=>{const next=new Set(prev);apply?next.delete(recordKey):next.add(recordKey);return next;});
 const applyAll=status=>setExcluded(prev=>{const next=new Set(prev);review.filter(item=>item.status===status).forEach(item=>next.delete(item.record.key));return next;});
 const excludeAll=status=>setExcluded(prev=>{const next=new Set(prev);review.filter(item=>item.status===status).forEach(item=>next.add(item.record.key));return next;});
 return <div className="layout">
  <aside><div className="brand">▥ CONSULT</div><span className="muted">상담 데이터 워크스페이스</span><button className={'nav '+(tab==='data'?'active':'')} onClick={()=>setTab('data')}>전체 자료</button><button className={'nav '+(tab==='upload'?'active':'')} onClick={()=>setTab('upload')}>↥ 업로드</button><div className="roadmap">다음 구현<br/>고객 상세 · 메모 입력<br/>홈 대시보드 · 상세 분석</div><footer>독립 프로젝트<br/>Supabase consult 스키마</footer></aside>
  <main>
   <header><span>{tab==='data'?'전체 자료':'업로드'}</span><span className="badge">{tab==='data'?'주요 통계 · 전체 자료':fileKind==='docx'?'Word 형식 확인':'엑셀 업로드 · DB 저장'}</span></header>
   {tab==='data'?<section className="intro"><div><h1>전체 자료</h1><p>DB에 저장된 상담 자료를 조회하고 확인 필요 항목을 필터링합니다.</p></div><button onClick={()=>setRefreshKey(k=>k+1)}>전체 자료 새로고침</button></section>:<section className="intro"><div><h1>상담 자료 업로드</h1><p>엑셀을 올리고 기존 DB와 비교한 뒤 적용할 행만 저장합니다.</p></div><button disabled={!sheets.length||busy} onClick={resetUpload}>자료 비우기</button></section>}
   {tab==='upload'&&<>
    <label className={'drop '+(busy?'busy':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();upload(e.dataTransfer.files[0]);}}>
     <input type="file" accept=".xlsx,.docx" disabled={busy} onChange={e=>{upload(e.target.files[0]);e.target.value='';}}/>
     <strong>{busy?'파일을 확인하고 있습니다…':'＋ XLSX 또는 Word 파일을 선택하거나 여기에 놓으세요'}</strong>
     <span>XLSX · oplist_YYMMDD~.docx · 최대 20MB · 파일 선택 시 로컬 검증</span>
    </label>
    {error&&<div role="alert" className="alert">{error}</div>}
    {fileKind==='docx'&&docxInfo&&<section className="card plan-body"><div className="toolbar"><h2>Word 파일 형식 확인</h2><span className="badge">검증 완료</span></div><p><strong>{fileName}</strong></p><p>수술기간 시작일: {docxInfo.periodStart} · 파일 크기: {(docxInfo.size/1024/1024).toFixed(2)}MB</p><p className="notice">현재 단계에서는 파일을 저장하지 않습니다. 다음 단계에서 Word 안의 사진과 특이사항을 추출합니다.</p></section>}
    {fileKind!=='docx'&&<CloudPanel fileName={fileName} hash={hash} sheet={reviewedSheet} onSaved={()=>{setRefreshKey(k=>k+1);setTab('data');}} onIdentityChange={()=>{resetUpload();setHash('');}}/>}
    {sheets.length>0&&<section className="card upload-summary">
     <div className="toolbar"><h2>업로드 자료 검토</h2><select aria-label="시트 선택" value={sheetIndex} onChange={e=>{setSheetIndex(Number(e.target.value));setSelected(null);}}>{sheets.map((s,i)=><option value={i} key={s.name}>{s.name}</option>)}</select></div>
     {sheet.error?<div role="alert" className="alert">{sheet.error}</div>:<>
      <div className="stats compact review-stats"><article><span>파일</span><strong>{fileName?1:0}<small>개</small></strong></article><article><span>인식 records</span><strong>{all.length}<small>건</small></strong></article><article><span>적용 예정</span><strong>{appliedCount}<small>건</small></strong><p className="stat-detail">제외 {excludedCount}</p></article>{reviewOrder.map(key=><article key={key} className="procedure-stat"><span>{reviewLabels[key]}</span><button className="stat-total" aria-pressed={reviewFilter===key} onClick={()=>setReviewFilter(reviewFilter===key?'all':key)}><strong>{reviewCounts[key]??0}<small>건</small></strong></button><p className="stat-detail"><button onClick={()=>applyAll(key)}>모두 적용</button><button onClick={()=>excludeAll(key)}>모두 제외</button></p></article>)}</div>
      {reviewMessage&&<div role="status" className="notice">{reviewBusy?'비교 중… ':''}{reviewMessage}</div>}
      {(reviewCounts.issue>0||reviewCounts.duplicate>0)&&<div role="alert" className="alert">확인 필요 {reviewCounts.issue}건 · 중복 의심 {reviewCounts.duplicate}건이 있습니다. 기본값은 제외이며, 필요한 행만 적용으로 바꾸세요.</div>}
      <div className="toolbar filters"><button className={reviewFilter==='all'?'active':''} onClick={()=>setReviewFilter('all')}>전체 검토</button>{reviewOrder.map(key=><button key={key} className={reviewFilter===key?'active':''} onClick={()=>setReviewFilter(key)}>{reviewLabels[key]} {reviewCounts[key]??0}</button>)}</div>
      <div className="mini-table review-table"><table><thead><tr><th>선택</th><th>분류</th><th>고객번호</th><th>이름</th><th>상담일</th><th>상담항목</th><th>차이/사유</th><th>원본</th></tr></thead><tbody>{reviewRows.slice(0,200).map(item=>{const fields=recordFields(item.record),isApplied=!excluded.has(item.record.key);return <tr key={item.record.key}><td><button className={isApplied?'apply-toggle active':'apply-toggle'} onClick={()=>setApplied(item.record.key,!isApplied)}>{isApplied?'적용':'제외'}</button></td><td><span className={`badge review-${item.status}`}>{reviewLabels[item.status]}</span></td><td>{fields.externalId||'—'}</td><td>{fields.name||'—'}</td><td>{fields.date||'—'}</td><td className="item-name">{fields.item||'—'}</td><td>{item.reason}</td><td><button className="link" onClick={()=>setSelected(item.record)}>보기</button></td></tr>;})}</tbody></table>{reviewRows.length>200&&<p className="notice">처음 200건만 표시합니다. 분류 카드를 눌러 범위를 좁혀 확인하세요.</p>}{!reviewRows.length&&<p className="empty">표시할 검토 항목이 없습니다.</p>}</div>
      {sheet.orphanRows?.length>0&&<div role="alert" className="alert">미배정 행 {sheet.orphanRows.length}건이 있어 DB 저장이 비활성화됩니다.</div>}
     </>}
    </section>}
   </>}
   {tab==='data'&&<ConsultationTable refreshKey={refreshKey}/>}
  </main>
  {selected&&<div className="overlay" onClick={()=>setSelected(null)}><section role="dialog" aria-modal="true" aria-label="원본 대조" className="detail" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setSelected(null);}}><div className="toolbar"><h2>{selected.name} · 원본 대조</h2><button autoFocus onClick={()=>setSelected(null)}>닫기 ✕</button></div><div className="alert"><strong>확인할 내용</strong><ul>{(selected.issues?.length?selected.issues:['검토 목록에서 기존 DB와의 차이를 확인하세요.']).map(t=><li key={t}>{t}</li>)}</ul></div><h3>복원된 기본정보</h3><dl>{Object.entries(selected.fields??{}).filter(([,v])=>v).map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl><h3>특이사항·메모</h3><pre>{selected.notes||'—'}</pre><h3>상담 내용</h3><pre>{selected.content||'—'}</pre><h3>상담 정보</h3><pre>{JSON.stringify(selected.consultation,null,2)}</pre><h3>수술·시술 후보</h3><pre>{JSON.stringify(selected.procedures,null,2)}</pre><h3>원본 셀 · 행 위치</h3>{selected.raw?.map(r=><div className="raw" key={r.number}><strong>{r.number}행</strong>{r.cells.map(c=><div key={c.column}><b>{c.column}</b><span>{c.value}</span></div>)}</div>)}</section></div>}
 </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
