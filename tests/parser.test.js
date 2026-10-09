import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,date} from '../src/lib/parser.js';
const header={number:2,cells:['선택','번호','No.','국가','주의','VIP','사진','특이','소개','소개자','소개자HP','이름','나이','생년월일','성별','주소','문자','이벤트','특이사항','외부','상담일','상태','상담일','상태','상담자','원장','상담항목']};
const patient=(number,id,name)=>{const cells=[];cells[2]=id;cells[11]=name;cells[14]='여';cells[18]='첫 메모';return {number,cells};};
const consult={number:5,cells:['이어진 메모',0,46154,'예약ok',46154,'예약ok','상담자A','원장A','눈','첫 상담 내용']};
test('variable blocks preserve notes, procedure continuations and boundaries',()=>{
 const p=parseRows([header,patient(3,232001,'가상A'),{number:4,cells:['긴 메모']},consult,{number:6,cells:['마지막 상담 내용','등록자',46155,'완료',46155,'완료','수술항목']},{number:7,cells:['추가 수술항목']},patient(8,232002,'가상B')]);
 assert.equal(p.records.length,2);assert.match(p.records[0].notes,/긴 메모/);assert.match(p.records[0].content,/마지막 상담 내용/);assert.equal(p.records[0].procedures.length,1);assert.match(p.records[0].procedureItems,/추가 수술항목/);assert.equal(p.records[1].notes,'첫 메모');assert.equal(p.records[1].consultation,null);
});
test('same-row procedure preserves both date slots',()=>{const r=parseRows([header,patient(3,232001,'가상'),{number:4,cells:[...consult.cells,'등록자',46155,'완료',46155,'완료','항목']}]).records[0];assert.equal(r.procedures.length,1);assert.equal(r.consultation.date1,r.consultation.date2);assert.equal(r.procedures.length,1);});
test('unknown rows and columns are flagged',()=>{const r=parseRows([header,{number:3,cells:['누락']},patient(4,232001,'가상'),{number:5,cells:['메모','알수없는 값']}]);assert.deepEqual(r.orphanRows,[3]);assert.ok(r.records[0].issues.some(t=>t.includes('미인식')));});
test('malformed patient boundary is quarantined',()=>{const r=parseRows([header,patient(3,232001,'가상A'),consult,patient(6,'오류','가상B'),{number:7,cells:['B의 메모']}]);assert.deepEqual(r.orphanRows,[6,7]);assert.ok(!r.records[0].notes.includes('B의'));});
test('standard row number is accepted as patient identifier',()=>{const r=parseRows([{number:1,cells:['번호','이름','상담항목','상담일1']},{number:2,cells:[232031,'가상','눈',46154]}]);assert.equal(r.records[0].externalId,'232031');assert.equal(r.records[0].issues.length,0);});
test('standard sheet maps stable No without broken layout',()=>{
 const r=parseRows([{number:1,cells:['No.','이름','상담일','상담상태','상담항목','수술일','수술항목','메모']},{number:2,cells:[232001,'가상',46154,'예약','눈, 코',46155,'눈','표준 메모']}]).records[0];
 assert.equal(r.externalId,'232001');assert.equal(r.consultation.date,'2026-05-12');assert.deepEqual(r.consultation.items,['눈','코']);assert.equal(r.procedures[0].date,'2026-05-13');assert.equal(r.issues.length,0);
});
test('standard sheet accepts english column names',()=>{
 const r=parseRows([{number:1,cells:['external_id','name','consultation_date','items','status','source_visit_id']},{number:2,cells:['c-1','가상','2026-05-12','눈','예약','v-1']}]).records[0];
 assert.equal(r.externalId,'c-1');assert.equal(r.sourceVisitId,'v-1');assert.equal(r.consultation.status,'예약');assert.equal(r.consultation.item,'눈');
});
test('dates validate and respect epoch',()=>{assert.equal(date(46154),'2026-05-12');assert.equal(date(46154,true),'2030-05-13');assert.equal(date('2026-02-30'),'');assert.equal(date('예약ok'),'');});
test('unsupported sheets fail explicitly',()=>assert.throws(()=>parseRows([{number:1,cells:['unknown']}]),/헤더/));

test('Excel numeric zero string still starts consultation',()=>{const c=[...consult.cells];c[1]='0.0';const r=parseRows([header,patient(3,'232001.0','가상'),{number:4,cells:c}]).records[0];assert.equal(r.consultation.date1,'2026-05-12');});
