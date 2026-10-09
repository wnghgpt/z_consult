import React,{useEffect,useMemo,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {connectionError} from '../lib/staging.js';

const text = value => Array.isArray(value) ? value.join(', ') : value ?? '';
const compactCellKeys=new Set(['이름','주소','특이사항','내용','수술항목','시술항목']);
const shouldCompact=(key,value)=>compactCellKeys.has(key)||String(value??'').length>24||String(value??'').includes('\n');
const PAGE_SIZE=50;
function pageNumbers(current,total){
 const pages=[];
 if(total<=7)return Array.from({length:total},(_,i)=>i);
 const add=p=>{if(!pages.includes(p))pages.push(p);};
 [0,1,total-2,total-1,current-1,current,current+1].forEach(p=>{if(p>=0&&p<total)add(p);});
 return pages.sort((a,b)=>a-b);
}
const columns=[
 ['번호','번호'],['국가','국가'],['주의','주의'],['VIP','VIP'],['사진','사진'],['특이','특이'],
 ['소개','소개'],['소개자','소개자'],['소개자HP','소개자HP'],['이름','이름'],['나이','나이'],['생년월일','생년월일'],['성별','성별'],['주소','주소'],
 ['문자','문자'],['이벤트','이벤트'],['특이사항','특이사항'],['외부','외부'],
 ['상담일1','상담일1'],['상담상태1','상담상태1'],['상담일2','상담일2'],['상담상태2','상담상태2'],['상담자','상담자'],['원장','원장'],['상담항목','상담항목'],['내용','내용'],['등록자','등록자'],
 ['수술일1','수술일1'],['수술상태1','수술상태1'],['수술일2','수술일2'],['수술상태2','수술상태2'],['수술항목','수술항목'],
 ['시술일1','시술일1'],['시술상태1','시술상태1'],['시술일2','시술일2'],['시술상태2','시술상태2'],['시술항목','시술항목'],
 ['원본행','원본행'],['확인','확인']
];
function field(row,key){
 const fields=row.source_snapshot?.fields??{};
 const firstValue=(...values)=>values.find(value=>String(value??'').trim()!=='')??'';
 const aliases={번호:['번호','No.','NO','no','고객번호','고객ID'],상담일1:['상담일1','상담일'],상담상태1:['상담상태1','상태'],수술일1:['수술일1','수술일'],수술상태1:['수술상태1'],시술일1:['시술일1','시술일'],시술상태1:['시술상태1']};
 const fallback={
  번호:row.external_id,이름:row.patient_name,상담일1:row.consultation_date,상담상태1:row.consultation_status,
  상담자:row.counselor,원장:row.doctor,상담항목:row.consultation_item,수술일1:row.procedure_date,
  수술상태1:row.procedure_status,수술항목:row.procedure_item,
 };
 return firstValue(...(aliases[key]??[key]).map(name=>fields[name]),fallback[key]);
}

const lower = value => String(value ?? '').toLowerCase();
function hasProcedureInfo(row){
 return ['수술일1','수술일2','수술상태1','수술상태2','수술항목','시술일1','시술일2','시술상태1','시술상태2','시술항목'].some(key=>String(field(row,key)??'').trim());
}
function isExplicitBooked(row){
 return lower(row.consultation_status).includes('예약ok') || lower(field(row,'상담상태1')).includes('예약ok') || lower(field(row,'상담상태2')).includes('예약ok');
}
function isProcedureInfoBooked(row){
 return !isExplicitBooked(row) && hasProcedureInfo(row);
}
function consultationNoShow(row){
 const status=lower([row.consultation_status,field(row,'상담상태1'),field(row,'상담상태2')].join(' '));
 return ['부도','취소','노쇼','미방문'].some(word=>status.includes(word));
}
function consultationBooked(row){
 return isExplicitBooked(row)||hasProcedureInfo(row);
}
function consultationNotBooked(row){
 return !consultationBooked(row)&&!consultationNoShow(row);
}
function procedureStatusKind(row){
 if(!hasProcedureInfo(row))return 'none';
 const status=lower([field(row,'수술상태1'),field(row,'수술상태2'),field(row,'시술상태1'),field(row,'시술상태2'),row.procedure_status].join(' '));
 if(status.includes('취소'))return 'canceled';
 if(status.includes('보류'))return 'hold';
 if(['완료','회복중','입실','진행'].some(word=>status.includes(word)))return 'done';
 if(['예약','예정','ok','당일수술','원장님 체크','원장님체크','담당실장 연결','수술전부재'].some(word=>status.includes(word)))return 'scheduled';
 return 'review';
}
function rowHasIssue(row){
 return Boolean(row.has_issues || procedureStatusKind(row)==='review');
}

function splitProcedureItems(row){
 const raw=[field(row,'수술항목'),field(row,'시술항목'),row.procedure_item].filter(Boolean).join('\n');
 return [...new Set(raw.split(/\n+/).map(v=>v.trim()).filter(Boolean))];
}

function regionParts(row){
 const country=String(field(row,'국가')||'').trim();
 const address=String(field(row,'주소')||'').replace(/\s+/g,' ').trim();
 if(country && !['대한민국','한국','국내'].includes(country))return {region:country,detail:''};
 if(!address)return {region:'지역 미입력',detail:''};
 const compact=address.replace(/\s+/g,'');
 const seoul=compact.match(/서울(?:특별시|시)?([가-힣]+구)/);
 if(seoul)return {region:'서울',detail:`서울 ${seoul[1]}`};
 const direct=compact.match(/^(경기도|경기|인천|부산|대구|대전|광주|울산|세종|강원도|강원|충청북도|충북|충청남도|충남|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주도|제주)/);
 if(direct){
  const map={경기도:'경기',강원도:'강원',충청북도:'충북',충청남도:'충남',전라북도:'전북',전라남도:'전남',경상북도:'경북',경상남도:'경남',제주도:'제주'};
  return {region:map[direct[1]]||direct[1],detail:''};
 }
 return {region:'기타 지역',detail:''};
}
function normalizeRegion(row){
 return regionParts(row).region;
}
function normalizeRegionDetail(row){
 const parts=regionParts(row);
 return parts.detail||parts.region;
}
function normalizeAgeGroup(row){
 const raw=String(field(row,'나이')||'').replace(/[^0-9]/g,'');
 const age=Number(raw);
 if(!age)return '나이 미입력';
 if(age<10)return '10세 미만';
 if(age>=70)return '70대 이상';
 return `${Math.floor(age/10)*10}대`;
}
function normalizeGender(row){
 const value=String(field(row,'성별')||'').trim();
 if(value.includes('남')||/^m$/i.test(value))return '남';
 if(value.includes('여')||/^f$/i.test(value))return '여';
 return '성별 미입력';
}
function normalizeReferral(row){
 const referred=['소개','소개자','소개자HP'].some(key=>String(field(row,key)||'').trim());
 const status=String([field(row,'상담상태1'),field(row,'상담상태2')].join(' '));
 if(referred||status.includes('소개고객'))return '소개';
 return '일반/미기재';
}
function topProcedureItem(itemCounts){
 const [item,count]=[...itemCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko'))[0]??[];
 return item?`${item} (${count})`:'—';
}
function aggregatePatientRows(rows,getKey){
 const map=new Map();
 for(const row of rows){
  const key=getKey(row);
  const entry=map.get(key)??{name:key,total:0,eligible:0,booked:0,noShow:0,notBooked:0,done:0,itemCounts:new Map()};
  entry.total+=1;
  if(consultationNoShow(row))entry.noShow+=1; else entry.eligible+=1;
  if(consultationBooked(row))entry.booked+=1;
  if(consultationNotBooked(row))entry.notBooked+=1;
  if(procedureStatusKind(row)==='done')entry.done+=1;
  if(consultationBooked(row)||hasProcedureInfo(row)){
   for(const item of splitProcedureItems(row))entry.itemCounts.set(item,(entry.itemCounts.get(item)??0)+1);
  }
  map.set(key,entry);
 }
 return [...map.values()].map(entry=>({...entry,topItem:topProcedureItem(entry.itemCounts)})).sort((a,b)=>b.total-a.total||b.booked-a.booked||a.name.localeCompare(b.name,'ko'));
}
function makePatientStats(rows){
 const regionRows=aggregatePatientRows(rows,normalizeRegion);
 const regionChildren={서울:aggregatePatientRows(rows.filter(row=>normalizeRegion(row)==='서울'),normalizeRegionDetail).filter(row=>row.name!=='서울')};
 return [
  {name:'지역별 예약 수술',rows:regionRows,children:regionChildren},
  {name:'연령대별 예약 수술',rows:aggregatePatientRows(rows,normalizeAgeGroup)},
  {name:'성별 예약 수술',rows:aggregatePatientRows(rows,normalizeGender)},
  {name:'소개 여부별 예약 수술',rows:aggregatePatientRows(rows,normalizeReferral)},
 ];
}
function makeAnalysis(rows){
 const counselorMap=new Map(), itemMap=new Map();
 for(const row of rows){
  const counselor=String(field(row,'상담자')||row.counselor||'미지정').trim()||'미지정';
  const c=counselorMap.get(counselor)??{name:counselor,total:0,eligible:0,booked:0,noShow:0,notBooked:0,done:0,canceled:0,hold:0,review:0};
  c.total+=1;
  if(consultationNoShow(row))c.noShow+=1; else c.eligible+=1;
  if(consultationBooked(row))c.booked+=1;
  if(consultationNotBooked(row))c.notBooked+=1;
  const kind=procedureStatusKind(row);
  if(kind==='done')c.done+=1;
  if(kind==='canceled')c.canceled+=1;
  if(kind==='hold')c.hold+=1;
  if(kind==='review')c.review+=1;
  counselorMap.set(counselor,c);
  for(const item of splitProcedureItems(row)){
   const entry=itemMap.get(item)??{name:item,total:0,done:0,scheduled:0,canceled:0,hold:0,review:0};
   entry.total+=1;
   if(kind==='done')entry.done+=1;
   if(kind==='scheduled')entry.scheduled+=1;
   if(kind==='canceled')entry.canceled+=1;
   if(kind==='hold')entry.hold+=1;
   if(kind==='review')entry.review+=1;
   itemMap.set(item,entry);
  }
 }
 return {
  counselors:[...counselorMap.values()].sort((a,b)=>b.total-a.total||b.booked-a.booked).slice(0,12),
  items:[...itemMap.values()].sort((a,b)=>b.total-a.total||b.canceled-a.canceled).slice(0,15),
 };
}

function parseDate(value){
 const text=String(value??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}/.test(text))return null;
 const date=new Date(`${text.slice(0,10)}T00:00:00+09:00`);
 return Number.isNaN(date.getTime())?null:date;
}
function daysBetween(a,b){
 if(!a||!b)return null;
 return Math.round((b.getTime()-a.getTime())/86400000);
}
function pct(part,total){
 return total?`${Math.round(part/total*1000)/10}%`:'0%';
}

function sortAnalysisRows(rows,sort){
 const dir=sort.dir==='asc'?1:-1;
 return [...rows].sort((a,b)=>{
  const av=sort.key==='rate'?a.booked/Math.max(1,a.eligible??a.total):sort.key==='cancelRate'?a.canceled/Math.max(1,a.total):a[sort.key];
  const bv=sort.key==='rate'?b.booked/Math.max(1,b.eligible??b.total):sort.key==='cancelRate'?b.canceled/Math.max(1,b.total):b[sort.key];
  if(typeof av==='number'&&typeof bv==='number')return (av-bv)*dir;
  return String(av??'').localeCompare(String(bv??''),'ko')*dir;
 });
}

export default function ConsultationTable({refreshKey=0}) {
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [query,setQuery]=useState(''),[issuesOnly,setIssuesOnly]=useState(false),[status,setStatus]=useState('all'),[page,setPage]=useState(0),[procedureFilter,setProcedureFilter]=useState('all'),[bookingFilter,setBookingFilter]=useState('all');
 const [expanded,setExpanded]=useState(()=>new Set()),[tooltip,setTooltip]=useState(null);
 const [counselorSort,setCounselorSort]=useState({key:'total',dir:'desc'}),[itemSort,setItemSort]=useState({key:'total',dir:'desc'});
 const [patientSorts,setPatientSorts]=useState({});
 const [expandedPatientGroups,setExpandedPatientGroups]=useState(()=>new Set());
 const toggleSort=(current,setter,key)=>setter(current.key===key?{key,dir:current.dir==='asc'?'desc':'asc'}:{key,dir:'desc'});
 const togglePatientSort=(name,key)=>setPatientSorts(prev=>{const current=prev[name]??{key:'total',dir:'desc'};return {...prev,[name]:current.key===key?{key,dir:current.dir==='asc'?'desc':'asc'}:{key,dir:'desc'}};});
 const togglePatientGroup=name=>setExpandedPatientGroups(prev=>{const next=new Set(prev);next.has(name)?next.delete(name):next.add(name);return next;});
 const sortLabel=(sort,key)=>sort.key===key?(sort.dir==='asc'?' ▲':' ▼'):'';
 const toggleCell=id=>setExpanded(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});
 async function load(){
  if(!supabase)return;
  setBusy(true);setMessage('');
  try{
   const {data,error}=await supabase.rpc('list_consultation_rows');
   if(error)throw error;
   setRows(data??[]);
  }catch(e){setMessage(connectionError(e));}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();},[refreshKey]);
 const filtered=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return rows.filter(r=>{
   if(issuesOnly&&!rowHasIssue(r))return false;
   if(bookingFilter==='booked'&&!consultationBooked(r))return false;
   if(bookingFilter==='notBooked'&&!consultationNotBooked(r))return false;
   if(bookingFilter==='noShow'&&!consultationNoShow(r))return false;
   if(procedureFilter==='procedure'&&!hasProcedureInfo(r))return false;
   if(['done','scheduled','canceled','hold','review'].includes(procedureFilter)&&procedureStatusKind(r)!==procedureFilter)return false;
   if(status!=='all'&&![r.consultation_status,r.procedure_status].some(v=>String(v??'').includes(status)))return false;
   if(!q)return true;
   return [...columns.map(([,key])=>field(r,key)),r.patient_notes,r.consultation_notes].join(' ').toLowerCase().includes(q);
  });
 },[rows,query,issuesOnly,status,procedureFilter,bookingFilter]);
 const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 const visible=filtered.slice(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE);
 const pages=pageNumbers(page,pageCount);
 const issueCount=rows.filter(rowHasIssue).length;
 const explicitBooked=rows.filter(isExplicitBooked).length;
 const procedureInfoBooked=rows.filter(isProcedureInfoBooked).length;
 const procedureRows=rows.filter(hasProcedureInfo);
 const procedureDone=procedureRows.filter(r=>procedureStatusKind(r)==='done').length;
 const procedureScheduled=procedureRows.filter(r=>procedureStatusKind(r)==='scheduled').length;
 const procedureCanceled=procedureRows.filter(r=>procedureStatusKind(r)==='canceled').length;
 const procedureHold=procedureRows.filter(r=>procedureStatusKind(r)==='hold').length;
 const procedureReview=procedureRows.filter(r=>procedureStatusKind(r)==='review').length;
 const analysis=useMemo(()=>makeAnalysis(rows),[rows]);
 const patientStats=useMemo(()=>makePatientStats(rows),[rows]);
 const sortedCounselors=useMemo(()=>sortAnalysisRows(analysis.counselors,counselorSort),[analysis,counselorSort]);
 const sortedItems=useMemo(()=>sortAnalysisRows(analysis.items,itemSort),[analysis,itemSort]);
 const sortedPatientStats=useMemo(()=>patientStats.map(group=>({
  ...group,
  sort:patientSorts[group.name]??{key:'total',dir:'desc'},
  rows:sortAnalysisRows(group.rows,patientSorts[group.name]??{key:'total',dir:'desc'}),
  children:Object.fromEntries(Object.entries(group.children??{}).map(([key,rows])=>[key,sortAnalysisRows(rows,patientSorts[group.name]??{key:'total',dir:'desc'})])),
 })),[patientStats,patientSorts]);
 const bookedCount=explicitBooked+procedureInfoBooked;
 const noShowCount=rows.filter(consultationNoShow).length;
 const notBookedCount=rows.filter(consultationNotBooked).length;
 const eligibleConsultations=rows.length-noShowCount;
 const conversionRate=pct(bookedCount,eligibleConsultations);
 const cancelRate=pct(procedureCanceled,procedureRows.length);
 const holdRate=pct(procedureHold,procedureRows.length);
 const intervals=procedureRows.map(r=>daysBetween(parseDate(field(r,'상담일1')||r.consultation_date),parseDate(field(r,'수술일1')||field(r,'시술일1')||r.procedure_date))).filter(v=>v!=null&&v>=0);
 const sameDay=intervals.filter(v=>v===0).length;
 const withinWeek=intervals.filter(v=>v>0&&v<=7).length;
 const overMonth=intervals.filter(v=>v>30).length;
 const today=new Date();today.setHours(0,0,0,0);
 const weekEnd=new Date(today);weekEnd.setDate(today.getDate()+6);
 const scheduledRows=procedureRows.filter(r=>procedureStatusKind(r)==='scheduled');
 const upcomingToday=scheduledRows.filter(r=>{const d=parseDate(field(r,'수술일1')||field(r,'시술일1')||r.procedure_date);return d&&d.getTime()===today.getTime();}).length;
 const upcomingWeek=scheduledRows.filter(r=>{const d=parseDate(field(r,'수술일1')||field(r,'시술일1')||r.procedure_date);return d&&d>=today&&d<=weekEnd;}).length;
 return <section className="card data-table"><div className="toolbar"><h2>전체 자료</h2><button disabled={busy} onClick={load}>{busy?'불러오는 중…':'새로고침'}</button></div>
  <div className="stats compact"><article className="procedure-stat"><span>상담</span><strong>{rows.length}<small>건</small></strong><p className="stat-detail"><button aria-pressed={bookingFilter==='booked'} onClick={()=>{setBookingFilter(bookingFilter==='booked'?'all':'booked');setPage(0);}}>예약 전환 {bookedCount}</button><button aria-pressed={bookingFilter==='notBooked'} onClick={()=>{setBookingFilter(bookingFilter==='notBooked'?'all':'notBooked');setPage(0);}}>미전환 {notBookedCount}</button><button aria-pressed={bookingFilter==='noShow'} onClick={()=>{setBookingFilter(bookingFilter==='noShow'?'all':'noShow');setPage(0);}}>미방문/취소 {noShowCount}</button></p></article><article><span>예약 전환</span><strong>{bookedCount}<small>건</small></strong><p className="stat-detail">전환율 {conversionRate} · 분모 {eligibleConsultations} · 예약ok {explicitBooked} · 수술/시술정보 {procedureInfoBooked}</p></article><article><span>취소/보류율</span><strong>{cancelRate}</strong><p className="stat-detail">취소 {procedureCanceled} · 보류 {procedureHold} / 기록 {procedureRows.length}</p></article><article><span>상담→수술</span><strong>{sameDay}<small>건</small></strong><p className="stat-detail">당일 · 7일내 {withinWeek} · 30일초과 {overMonth}</p></article><article className="procedure-stat"><span>수술/시술 기록</span><button className="stat-total" aria-pressed={procedureFilter==='procedure'} onClick={()=>{setProcedureFilter(procedureFilter==='procedure'?'all':'procedure');setPage(0);}}><strong>{procedureRows.length}<small>건</small></strong></button><p className="stat-detail"><button aria-pressed={procedureFilter==='done'} onClick={()=>{setProcedureFilter(procedureFilter==='done'?'all':'done');setPage(0);}}>완료 {procedureDone}</button><button aria-pressed={procedureFilter==='scheduled'} onClick={()=>{setProcedureFilter(procedureFilter==='scheduled'?'all':'scheduled');setPage(0);}}>예정 {procedureScheduled}</button><button aria-pressed={procedureFilter==='canceled'} onClick={()=>{setProcedureFilter(procedureFilter==='canceled'?'all':'canceled');setPage(0);}}>취소 {procedureCanceled}</button><button aria-pressed={procedureFilter==='hold'} onClick={()=>{setProcedureFilter(procedureFilter==='hold'?'all':'hold');setPage(0);}}>보류 {procedureHold}</button><button aria-pressed={procedureFilter==='review'} onClick={()=>{setProcedureFilter(procedureFilter==='review'?'all':'review');setPage(0);}}>확인 {procedureReview}</button></p></article></div>

  <section className="analysis-grid">
   <article className="card analysis-card"><div className="toolbar"><h2>상담자별 예약 전환율</h2></div><div className="mini-table"><table><thead><tr><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'name')}>상담자{sortLabel(counselorSort,'name')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'total')}>상담{sortLabel(counselorSort,'total')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'eligible')}>방문상담{sortLabel(counselorSort,'eligible')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'booked')}>예약전환{sortLabel(counselorSort,'booked')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'rate')}>전환율{sortLabel(counselorSort,'rate')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'notBooked')}>미전환{sortLabel(counselorSort,'notBooked')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(counselorSort,setCounselorSort,'noShow')}>미방문/취소{sortLabel(counselorSort,'noShow')}</button></th></tr></thead><tbody>{sortedCounselors.map(r=><tr key={r.name}><td>{r.name}</td><td>{r.total}</td><td>{r.eligible}</td><td>{r.booked}</td><td>{pct(r.booked,r.eligible)}</td><td>{r.notBooked}</td><td>{r.noShow}</td></tr>)}</tbody></table>{!analysis.counselors.length&&<p className="empty">상담자 데이터가 없습니다.</p>}</div></article>
   <article className="card analysis-card"><div className="toolbar"><h2>수술/시술 항목별 완료/취소</h2></div><div className="mini-table"><table><thead><tr><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'name')}>항목{sortLabel(itemSort,'name')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'total')}>전체{sortLabel(itemSort,'total')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'done')}>완료{sortLabel(itemSort,'done')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'scheduled')}>예정{sortLabel(itemSort,'scheduled')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'canceled')}>취소{sortLabel(itemSort,'canceled')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'hold')}>보류{sortLabel(itemSort,'hold')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'review')}>확인{sortLabel(itemSort,'review')}</button></th><th><button className="sort-head" onClick={()=>toggleSort(itemSort,setItemSort,'cancelRate')}>취소율{sortLabel(itemSort,'cancelRate')}</button></th></tr></thead><tbody>{sortedItems.map(r=><tr key={r.name}><td className="item-name">{r.name}</td><td>{r.total}</td><td>{r.done}</td><td>{r.scheduled}</td><td>{r.canceled}</td><td>{r.hold}</td><td>{r.review}</td><td>{pct(r.canceled,r.total)}</td></tr>)}</tbody></table>{!analysis.items.length&&<p className="empty">수술/시술 항목 데이터가 없습니다.</p>}</div></article>
  </section>

  <section className="patient-analysis-grid">
   {sortedPatientStats.map(group=><article className="card analysis-card" key={group.name}><div className="toolbar"><h2>{group.name}</h2></div><div className="mini-table"><table><thead><tr><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'name')}>구분{sortLabel(group.sort,'name')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'total')}>상담{sortLabel(group.sort,'total')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'eligible')}>방문상담{sortLabel(group.sort,'eligible')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'booked')}>예약전환{sortLabel(group.sort,'booked')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'rate')}>전환율{sortLabel(group.sort,'rate')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'notBooked')}>미전환{sortLabel(group.sort,'notBooked')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'noShow')}>미방문/취소{sortLabel(group.sort,'noShow')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'done')}>완료{sortLabel(group.sort,'done')}</button></th><th><button className="sort-head" onClick={()=>togglePatientSort(group.name,'topItem')}>주요 예약 수술/시술{sortLabel(group.sort,'topItem')}</button></th></tr></thead><tbody>{group.rows.flatMap(r=>{const childKey=`${group.name}:${r.name}`,children=group.children?.[r.name]??[],expanded=expandedPatientGroups.has(childKey);return [<tr key={childKey}><td>{children.length?<button className="drill-toggle" aria-expanded={expanded} onClick={()=>togglePatientGroup(childKey)}>{expanded?'▾':'▸'} {r.name}</button>:r.name}</td><td>{r.total}</td><td>{r.eligible}</td><td>{r.booked}</td><td>{pct(r.booked,r.eligible)}</td><td>{r.notBooked}</td><td>{r.noShow}</td><td>{r.done}</td><td className="item-name">{r.topItem}</td></tr>,...(expanded?children.map(child=><tr className="child-row" key={`${childKey}:${child.name}`}><td>{child.name}</td><td>{child.total}</td><td>{child.eligible}</td><td>{child.booked}</td><td>{pct(child.booked,child.eligible)}</td><td>{child.notBooked}</td><td>{child.noShow}</td><td>{child.done}</td><td className="item-name">{child.topItem}</td></tr>):[])];})}</tbody></table>{!group.rows.length&&<p className="empty">집계할 데이터가 없습니다.</p>}</div></article>)}
  </section>
  <div className="toolbar filters"><input aria-label="전체 자료 검색" placeholder="고객번호 · 이름 · 상담항목 · 상태 검색" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>
   <select aria-label="상태 필터" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="all">전체 상태</option><option value="예약">예약</option><option value="완료">완료</option><option value="취소">취소</option><option value="미예약">미예약</option></select>
   <label><input type="checkbox" checked={issuesOnly} onChange={e=>{setIssuesOnly(e.target.checked);setPage(0);}}/> 확인 필요만</label>{bookingFilter!=='all'&&<button onClick={()=>{setBookingFilter('all');setPage(0);}}>예약 필터 해제</button>}{procedureFilter!=='all'&&<button onClick={()=>{setProcedureFilter('all');setPage(0);}}>수술/시술 필터 해제</button>}</div>
  {message&&<p role="status" className="notice">{message}</p>}
  <div className="tablewrap"><table><thead><tr>{columns.map(([label])=><th key={label}>{label}</th>)}</tr></thead>
   <tbody>{visible.map(r=><tr key={r.consultation_id}>{columns.map(([label,key])=>{
    if(key==='확인'){const review=procedureStatusKind(r)==='review';return <td key={label}>{r.has_issues||review?<span className="badge warning">{review?'수술상태 확인':'확인 필요'}</span>:<span className="badge">정상</span>}</td>;}
    const value=text(field(r,key))||'—',cellId=`${r.consultation_id}:${key}`,compact=shouldCompact(key,value),isExpanded=expanded.has(cellId);
    return <td key={label} className={compact?`clip-cell ${key==='이름'?'name-cell':''} ${isExpanded?'expanded':''}`:''}>{compact?<button type="button" className="cell-text" aria-expanded={isExpanded} onClick={()=>toggleCell(cellId)} onMouseEnter={e=>{if(value==='—')return;const box=e.currentTarget.getBoundingClientRect();setTooltip({text:value,x:Math.min(box.left,window.innerWidth-440),y:Math.min(box.bottom+8,window.innerHeight-280)});}} onMouseLeave={()=>setTooltip(null)}>{value}</button>:value}</td>;
   })}</tr>)}</tbody></table>{!visible.length&&<p className="empty">저장된 상담 자료가 없습니다.</p>}</div>
  {tooltip&&<div className="cell-popover" style={{left:tooltip.x,top:tooltip.y}}>{tooltip.text}</div>}
  <div className="pagination"><span>총 {filtered.length}건 · {page+1} / {pageCount}</span><nav className="page-nav" aria-label="자료 페이지"><button disabled={!page} onClick={()=>setPage(page-1)}>이전</button>{pages.map((p,i)=><React.Fragment key={p}>{i>0&&pages[i-1]+1<p&&<em>…</em>}<button className="page-number" aria-current={p===page?'page':undefined} disabled={p===page} onClick={()=>setPage(p)}>{p+1}</button></React.Fragment>)}<button disabled={page+1>=pageCount} onClick={()=>setPage(page+1)}>다음</button></nav><i aria-hidden="true" /></div>
 </section>;
}
