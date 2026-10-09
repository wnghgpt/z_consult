import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileHash,stagingPayload,connectionError} from '../src/lib/staging.js';
const valid={fileName:'synthetic.xlsx',hash:'a'.repeat(64),sheetName:'sheet',records:[{key:'3'}]};
test('hash is content based SHA-256',async()=>{assert.equal(await fileHash(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');});
test('staging requires file fingerprint and bounded nonempty records',()=>{assert.throws(()=>stagingPayload({...valid,hash:''}));assert.throws(()=>stagingPayload({...valid,records:[]}));assert.throws(()=>stagingPayload({...valid,records:Array(2001).fill({key:'3'})}));assert.throws(()=>stagingPayload({...valid,records:[{key:'3',content:'한'.repeat(1800000)}]}));});
test('staging sends original evidence only through explicit payload',()=>{const p=stagingPayload(valid);assert.deepEqual(p.p_records,valid.records);assert.equal(p.p_file_sha256,valid.hash);});
test('setup failures and permission denial have distinct messages',()=>{assert.match(connectionError({code:'PGRST106'}),/스키마/);assert.match(connectionError({code:'42501'}),/접근 권한/);});
