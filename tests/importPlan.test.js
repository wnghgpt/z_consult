import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planImport} from '../src/lib/importPlan.js';
const row=(overrides={})=>({key:'3',externalId:'123456',name:'합성고객',fields:{번호:'1'},notes:'',content:'상담',consultation:{date1:'2026-05-01'},procedures:[],issues:[],...overrides});
const confirmed={identityConfirmed:true};
test('no baseline never implies empty DB',()=>assert.equal(planImport([row()])[0].action,'review'));
test('unconfirmed identity blocks matching',()=>assert.equal(planImport([row()],[row()])[0].action,'review'));
test('changed row numbers do not prevent same-content detection',()=>assert.equal(planImport([row({key:'50',fields:{번호:'47'}})],[row()],confirmed)[0].action,'duplicate'));
test('partial baseline cannot prove new patient',()=>assert.equal(planImport([row({externalId:'999'})],[row()],confirmed)[0].action,'review'));
test('complete baseline permits new patient candidate',()=>assert.equal(planImport([row({externalId:'999'})],[row()],{...confirmed,baselineComplete:true})[0].action,'new_patient'));
test('changed dates with complete baseline are treated as a separate consultation',()=>assert.equal(planImport([row({consultation:{date1:'2026-06-01'}})],[row()],{...confirmed,baselineComplete:true})[0].action,'new_visit'));
test('older or unversioned changes are held',()=>assert.equal(planImport([row({sourceVisitId:'v1',sourceUpdatedAt:'2026-05-01',content:'changed'})],[row({sourceVisitId:'v1',sourceUpdatedAt:'2026-05-02'})],confirmed)[0].action,'review'));
test('stable visit plus newer source version permits update candidate',()=>assert.equal(planImport([row({sourceVisitId:'v1',sourceUpdatedAt:'2026-05-03',content:'changed'})],[row({sourceVisitId:'v1',sourceUpdatedAt:'2026-05-02'})],confirmed)[0].action,'update'));
test('different date or item with full baseline permits separate consultation',()=>assert.equal(planImport([row({sourceVisitId:'v2',content:'new',consultation:{date1:'2026-06-01'}})],[row({sourceVisitId:'v1'})],{...confirmed,baselineComplete:true})[0].action,'new_visit'));
test('same batch and parser issues are never auto-accepted',()=>{
 assert.ok(planImport([row(),row({key:'8'})],[row()],confirmed).every(p=>p.action==='review'));
 assert.equal(planImport([row({issues:['미인식']})],[row()],confirmed)[0].action,'review');
});
test('same ID with different name is held',()=>assert.equal(planImport([row({name:'다른이름'})],[row()],confirmed)[0].action,'review'));

test('same customer date and item identify the same consultation',()=>assert.equal(planImport([row({sourceVisitId:'v2',content:'updated'})],[row({sourceVisitId:'v1'})],{...confirmed,baselineComplete:true})[0].action,'update'));
