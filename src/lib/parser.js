// Pure, conservative parser. Duplicate date slots are preserved, never assumed to be visits.
export const text = value => value == null ? '' : value instanceof Date ? value.toISOString().slice(0,10) : String(value).trim();
export function date(value, date1904 = false) {
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0,10);
  const s = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s); return !isNaN(d) && d.toISOString().slice(0,10) === s ? s : '';
  }
  const num = Number(s);
  if (!s || !Number.isFinite(num) || num < 20000 || num > 80000) return '';
  return new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.floor(num)*86400000).toISOString().slice(0,10);
}
const status = v => /^(예약|예약ok|완료|취소|대기|미예약|상담|미방문|노쇼|진행|접수|당일수술|원장님체크|원장님 체크|부도|소개고객|수술보류|수술전부재|담당실장|보류)/i.test(text(v));
const dateStatus = (c,i,epoch) => date(c[i],epoch) && status(c[i+1]);
const pair = (c,i,epoch) => dateStatus(c,i,epoch) && dateStatus(c,i+2,epoch);
const id = v => /^\d+(?:\.0+)?$/.test(text(v));
const col = index => { let s=''; for(let n=index+1;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s;return s; };
const norm = value => text(value).toLowerCase().replace(/[\s_.\-()[\]/]/g,'');
const findHeader = (header, names) => {
  const wanted = new Set(names.map(norm));
  return header.findIndex(h => wanted.has(norm(h)));
};
const splitItems = value => text(value).split(/[,;/·\n]+/).map(v=>v.trim()).filter(Boolean);
const first = (...values) => values.find(v => text(v)) ?? '';
const uniq = values => [...new Set(values.map(v => text(v)).filter(Boolean))];
const procedureItemText = value => {
  const s = text(value);
  return /\[(pr|se|te)\]/i.test(s) || /눈\s*>/.test(s) || /오메가라이트/i.test(s);
};
const birthText = value => {
  const raw=text(value);
  if(!raw)return '';
  return /^\d{5}$/.test(raw)?'0'+raw:raw;
};
const phoneText = value => {
  const raw=text(value);
  if(!raw)return {value:'',issue:false};
  const digits=raw.replace(/\D/g,'');
  if(!digits)return {value:raw,issue:false};
  const normalized=digits.length===10&&digits.startsWith('10')?'0'+digits:digits;
  if(normalized.length===11&&normalized.startsWith('010'))return {value:`${normalized.slice(0,3)}-${normalized.slice(3,7)}-${normalized.slice(7)}`,issue:false};
  if(/[0-9]/.test(raw)&&digits.length>=7)return {value:raw,issue:true};
  return {value:raw,issue:false};
};
const nameText = value => /^[가-힣]{2,5}$/.test(text(value));
const STANDARD = {
  externalId: ['No.','NO','no','번호','고객번호','고객ID','고객id','external_id','externalId','patient_id'],
  visitId: ['방문번호','상담번호','visit_id','source_visit_id'],
  sourceUpdatedAt: ['수정일','수정시각','updated_at','source_updated_at'],
  name: ['이름','고객명','성명','name'],
  notes: ['메모','특이사항','notes','memo'],
  content: ['내용','상담내용','content'],
  consultationDate: ['상담일','상담일1','consultation_date','consultationDate'],
  consultationDate2: ['상담일2'],
  consultationStatus: ['상담상태','상담상태1','예약상태','상태','status'],
  consultationStatus2: ['상담상태2'],
  counselor: ['상담자','상담실장','counselor'],
  doctor: ['원장','의사','doctor'],
  consultationItems: ['상담항목','상담부위','상담내용분류','items','consultation_items'],
  surgeryDate: ['수술일','수술일1','surgery_date'],
  surgeryDate2: ['수술일2'],
  surgeryStatus: ['수술상태','수술상태1'],
  surgeryStatus2: ['수술상태2'],
  surgeryItems: ['수술항목','수술부위','procedure_items','surgery_items'],
  treatmentDate: ['시술일','시술일1','treatment_date'],
  treatmentDate2: ['시술일2'],
  treatmentStatus: ['시술상태','시술상태1'],
  treatmentStatus2: ['시술상태2'],
  treatmentItems: ['시술항목','시술부위','treatment_items'],
};
export function parseRows(rows, {date1904=false}={}) {
  const headerIndex=rows.findIndex(r=>{
    const h=r.cells.map(text);
    return findHeader(h, STANDARD.name)>=0 && findHeader(h, STANDARD.consultationItems)>=0;
  });
  if(headerIndex<0) throw new Error('이름·상담항목 헤더를 찾지 못했습니다. 지원하는 고객목록 파일인지 확인해 주세요.');
  const header=rows[headerIndex].cells.map(text);
  const broken=findHeader(header,['No.'])===2 && findHeader(header,['이름'])===11 && findHeader(header,['상담항목'])>=20;
  const records=[], orphanRows=[];
  let current=null, phase='notes';
  const append=(key,v)=>{if(text(v))current[key]+=(current[key]?'\n':'')+text(v);};
  const appendProcedureItem=(v)=>{
    const value=text(v);
    if(!value)return;
    append('procedureItems',value);
    const last=current.procedures[current.procedures.length-1];
    if(!last){current.issues.push('수술·시술 항목으로 보이는 줄이 있지만 연결할 수술·시술 날짜가 없습니다.');return;}
    last.item += (last.item?'\n':'') + value;
    last.items = uniq([...(last.items??[]), ...splitItems(value)]);
    const fieldKey=last.kind==='treatment'?'시술항목':'수술항목';
    appendField(fieldKey,value);
  };
  const newRecord=(r,externalId,name)=>({key:String(r.number),externalId:text(externalId).replace(/\.0+$/,''),name:text(name),notes:'',content:'',procedureItems:'',consultation:null,procedures:[],issues:[],raw:[],fields:{}});
  const addRaw=r=>current.raw.push({number:r.number,cells:r.cells.map((v,i)=>({column:col(i),value:text(v)})).filter(c=>c.value)});
  const segment=(c,i)=>({date1:date(c[i],date1904),status1:text(c[i+1]),date2:date(c[i+2],date1904),status2:text(c[i+3])});
  const segmentFlexible=(c,i)=>{
    const d1=date(c[i],date1904),s1=text(c[i+1]),d2=date(c[i+2],date1904),s2=text(c[i+3]);
    return {date1:d1||d2,status1:s1||s2,date2:d2||d1,status2:s2||s1};
  };
  const lineHasPair=(c,i)=>dateStatus(c,i,date1904)||dateStatus(c,i+2,date1904);
  const setField=(key,value)=>{const v=text(value);if(v)current.fields[key]=v;};
  const setDateField=(key,value)=>{const v=date(value,date1904)||text(value);if(v)current.fields[key]=v;};
  const appendField=(key,value)=>{const v=text(value);if(v)current.fields[key]=(current.fields[key]?current.fields[key]+'\n':'')+v;};
  const appendRegistrar=value=>{const v=text(value);if(!v)return;if(!current.consultation)current.consultation={};if(!current.consultation.registrar)current.consultation.registrar=v;else if(!current.consultation.registrar.split('\n').includes(v))current.consultation.registrar+='\n'+v;if(!String(current.fields['등록자']??'').split('\n').includes(v))appendField('등록자',v);};
  const standardValue = (cells, key) => {
    const i = findHeader(header, STANDARD[key] ?? []);
    return i < 0 ? '' : cells[i];
  };
  const standardProcedure = (cells, kind, prefix) => {
    const item = standardValue(cells, `${prefix}Items`);
    const date1 = date(standardValue(cells, `${prefix}Date`), date1904);
    const date2 = date(standardValue(cells, `${prefix}Date2`), date1904);
    const status1 = text(standardValue(cells, `${prefix}Status`));
    const status2 = text(standardValue(cells, `${prefix}Status2`));
    if(!text(item) && !date1 && !date2 && !status1 && !status2) return null;
    return {kind,date: first(date1,date2),date1,date2,status: first(status1,status2),status1,status2,item:text(item),items:splitItems(item)};
  };
  for(const row of rows.slice(headerIndex+1)) {
    const c=row.cells;
    if(!c.some(v=>text(v)))continue;
    if(c.some(v=>text(v)==='이름')&&c.some(v=>text(v)==='상담항목')){current=null;continue;}
    if(!broken){
      const name=standardValue(c,'name');
      if(!text(name)){orphanRows.push(row.number);continue;}
      current=newRecord(row,standardValue(c,'externalId'),name);records.push(current);addRaw(row);
      current.key=current.externalId||String(row.number);
      header.forEach((h,i)=>{if(h)current.fields[h]=text(c[i]);});
      if(!current.externalId)current.issues.push('정리본의 고정 고객번호를 확인하지 못했습니다.');
      current.sourceVisitId=text(standardValue(c,'visitId'));
      current.sourceUpdatedAt=text(standardValue(c,'sourceUpdatedAt'));
      current.notes=text(standardValue(c,'notes'));current.content=text(standardValue(c,'content'));
      const item=standardValue(c,'consultationItems');
      const date1=date(standardValue(c,'consultationDate'),date1904);
      const date2=date(standardValue(c,'consultationDate2'),date1904);
      const status1=text(standardValue(c,'consultationStatus'));
      const status2=text(standardValue(c,'consultationStatus2'));
      current.consultation={date:first(date1,date2),date1,date2,status:first(status1,status2),status1,status2,counselor:text(standardValue(c,'counselor')),doctor:text(standardValue(c,'doctor')),item:text(item),items:splitItems(item)};
      for(const p of [standardProcedure(c,'surgery','surgery'),standardProcedure(c,'treatment','treatment')])if(p)current.procedures.push(p);
      continue;
    }
    // A partial patient start must close the preceding block instead of contaminating it.
    const start=id(c[2]) && Number(c[2])>80000 && text(c[11]);
    if(start){
      current=newRecord(row,c[2],c[11]);records.push(current);phase='notes';addRaw(row);
      header.slice(0,20).forEach((h,i)=>{if(h)current.fields[h]=text(c[i]);});
      {const birth=birthText(c[13]);if(birth)current.fields['생년월일']=birth;}
      {const phone=phoneText(c[10]);if(phone.value)current.fields['소개자HP']=phone.value;if(phone.issue)current.issues.push('소개자 연락처 원문 보존: 숫자 변환 여부 확인 필요');}
      append('notes',c[18]);
      if(lineHasPair(c,20)){
        setField('외부',c[19]);
        current.consultation={...segmentFlexible(c,20),date:segmentFlexible(c,20).date1,status:segmentFlexible(c,20).status1,counselor:text(c[24]),doctor:text(c[25]),item:text(c[26]),items:splitItems(c[26]),registrar:text(c[28])};
        {const seg=segmentFlexible(c,20);setField('상담일1',seg.date1);setField('상담상태1',seg.status1);setField('상담일2',seg.date2);setField('상담상태2',seg.status2);}
        setField('상담자',c[24]);setField('원장',c[25]);setField('상담항목',c[26]);append('content',c[27]);appendField('내용',c[27]);setField('등록자',c[28]);phase='content';
        if(lineHasPair(c,29)){
          {const seg=segmentFlexible(c,29);setField('수술일1',seg.date1);setField('수술상태1',seg.status1);setField('수술일2',seg.date2);setField('수술상태2',seg.status2);}
          current.procedures.push({...segmentFlexible(c,29),kind:'surgery',date:segmentFlexible(c,29).date1,status:segmentFlexible(c,29).status1,item:'',items:[]});appendProcedureItem(c[33]);phase='procedureItems';
        }
      }else if(c.slice(20).some(v=>text(v)))current.issues.push('기본정보 행에 추가 정보가 있습니다. 원본 확인이 필요합니다.');
      continue;
    }
    if(!current){orphanRows.push(row.number);continue;}
    // Patient-like row with malformed ID: quarantine rather than absorb into prior patient.
    if(text(c[11]) && ['남','여'].includes(text(c[14])) && !pair(c,2,date1904)){
      current=null;orphanRows.push(row.number);continue;
    }
    addRaw(row);
    if(lineHasPair(c,2)&&text(c[1])!=='' && Number(c[1])===0){
      if(current.consultation){current.issues.push('상담 구간이 여러 개 발견되었습니다. 자동 병합하지 않습니다.');continue;}
      append('notes',c[0]);appendField('특이사항',c[0]);setField('외부',c[1]);
      current.consultation={...segmentFlexible(c,2),date:segmentFlexible(c,2).date1,status:segmentFlexible(c,2).status1,counselor:text(c[6]),doctor:text(c[7]),item:text(c[8]),items:splitItems(c[8]),registrar:text(c[10])};
      {const seg=segmentFlexible(c,2);setField('상담일1',seg.date1);setField('상담상태1',seg.status1);setField('상담일2',seg.date2);setField('상담상태2',seg.status2);}setField('상담자',c[6]);setField('원장',c[7]);setField('상담항목',c[8]);setField('등록자',c[10]);
      append('content',c[9]);appendField('내용',c[9]);phase='content';
      if(lineHasPair(c,11)){
        {const seg=segmentFlexible(c,11);setField('수술일1',seg.date1);setField('수술상태1',seg.status1);setField('수술일2',seg.date2);setField('수술상태2',seg.status2);}
        current.procedures.push({...segmentFlexible(c,11),kind:'surgery',date:segmentFlexible(c,11).date1,status:segmentFlexible(c,11).status1,item:'',items:[]});appendProcedureItem(c[15]);phase='procedureItems';
        if(lineHasPair(c,16)){
          {const seg=segmentFlexible(c,16);setField('시술일1',seg.date1);setField('시술상태1',seg.status1);setField('시술일2',seg.date2);setField('시술상태2',seg.status2);}
          current.procedures.push({...segmentFlexible(c,16),kind:'treatment',date:segmentFlexible(c,16).date1,status:segmentFlexible(c,16).status1,item:'',items:[]});appendProcedureItem(c[20]);phase='procedureItems';
          if(c.slice(21).some(v=>text(v)))current.issues.push('수술·시술 구간 뒤 추가 열 확인 필요');
        }else if(c.slice(16).some(v=>text(v)))current.issues.push('수술 구간 뒤 추가 열 확인 필요');
      }else if(lineHasPair(c,16)){
        {const seg=segmentFlexible(c,16);setField('시술일1',seg.date1);setField('시술상태1',seg.status1);setField('시술일2',seg.date2);setField('시술상태2',seg.status2);}
        current.procedures.push({...segmentFlexible(c,16),kind:'treatment',date:segmentFlexible(c,16).date1,status:segmentFlexible(c,16).status1,item:'',items:[]});appendProcedureItem(c[20]);phase='procedureItems';
      }else if(c.slice(11).some(v=>text(v)))current.issues.push('상담 뒤 미인식 열 확인 필요');
    }else if(lineHasPair(c,2)&&current.consultation){
      if(procedureItemText(c[0]))appendProcedureItem(c[0]);else {append(phase,c[0]);appendField(phase==='content'?'내용':'특이사항',c[0]);}if(text(c[1]))appendRegistrar(c[1]);current.procedures.push({...segmentFlexible(c,2),kind:'surgery',date:segmentFlexible(c,2).date1,status:segmentFlexible(c,2).status1,item:'',items:[]});{const seg=segmentFlexible(c,2);setField('수술일1',seg.date1);setField('수술상태1',seg.status1);setField('수술일2',seg.date2);setField('수술상태2',seg.status2);}appendProcedureItem(c[6]);phase='procedureItems';
      if(lineHasPair(c,11)){
        {const seg=segmentFlexible(c,11);setField('시술일1',seg.date1);setField('시술상태1',seg.status1);setField('시술일2',seg.date2);setField('시술상태2',seg.status2);}
        current.procedures.push({...segmentFlexible(c,11),kind:'treatment',date:segmentFlexible(c,11).date1,status:segmentFlexible(c,11).status1,item:'',items:[]});appendProcedureItem(c[15]);phase='procedureItems';
        if(c.slice(16).some(v=>text(v)))current.issues.push('수술·시술 추가 열 확인 필요');
      }else if(c.slice(7).some(v=>text(v)))current.issues.push('수술·시술 추가 열 확인 필요');
    }else{
      if(procedureItemText(c[0])){appendProcedureItem(c[0]);phase='procedureItems';}
      else {append(phase,c[0]);appendField(phase==='content'?'내용':phase==='procedureItems'?'수술항목':'특이사항',c[0]);}
      if(text(c[1])&&nameText(c[1])&&!c.slice(2).some(v=>text(v)))appendRegistrar(c[1]);
      else if(c.slice(1).some(v=>text(v)))current.issues.push(`${row.number}행: 미인식 열이 있어 원본 확인 필요`);
    }
  }
  for(const r of records){
    if(r.raw?.length){const nums=r.raw.map(row=>row.number);r.fields['원본행']=nums.length>1?`${Math.min(...nums)}-${Math.max(...nums)}`:String(nums[0]);}
    if(!r.consultation?.date)r.issues.push('상담일을 확정하지 못했습니다.');
    r.issues=[...new Set(r.issues)];
  }
  return {format:broken?'깨진 원본':'정리본',records,orphanRows,headerRow:rows[headerIndex].number};
}
