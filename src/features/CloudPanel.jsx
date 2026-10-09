import React,{useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {PARSER_VERSION,connectionError,stagingPayload} from '../lib/staging.js';
export default function CloudPanel({fileName,hash,sheet,onIdentityChange,onSaved}){
 const [session,setSession]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[message,setMessage]=useState(''),[history,setHistory]=useState([]);
 const historySelect='id,file_name,sheet_name,parser_version,status,created_at,result';
 useEffect(()=>{
  if(!supabase)return;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));
  return ()=>subscription.unsubscribe();
 },[]);
 const userId=session?.user.id;
 useEffect(()=>{onIdentityChange();},[userId]);
 useEffect(()=>{
  let active=true;setReady(false);setHistory([]);setMessage('');
  if(!session||!supabase)return ()=>{active=false;};
  (async()=>{
   try{
    const {data:access,error}=await supabase.rpc('can_access');
    if(error)throw error;
    if(!access){if(active)setMessage('로그인되었습니다. 상담 앱 전용 접근 권한 설정이 필요합니다.');return;}
    const {data,error:readError}=await supabase.from('imports').select(historySelect).order('created_at',{ascending:false}).limit(5);
    if(readError)throw readError;
    if(active){setReady(true);setHistory(data);setMessage('연결 확인 완료 · DB 저장이 가능합니다.');}
   }catch(e){if(active)setMessage(connectionError(e));}
  })();
  return ()=>{active=false;};
 },[session]);
 async function login(e){e.preventDefault();setBusy(true);setMessage('');try{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;setPassword('');}catch(e){setMessage(connectionError(e));}finally{setBusy(false);}}
 async function logout(){setBusy(true);try{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;setHistory([]);setReady(false);setPassword('');}catch(e){setMessage(connectionError(e));}finally{setBusy(false);}}
 async function save(){setBusy(true);setMessage('');try{
  const payload=stagingPayload({fileName,hash,sheetName:sheet.name,records:sheet.records});
  const {data:importId,error}=await supabase.rpc('stage_import',payload);if(error)throw error;
  const {data:applied,error:applyError}=await supabase.rpc('apply_import',{p_import_id:importId});if(applyError)throw applyError;
  setMessage(`DB 저장 완료 · parser ${PARSER_VERSION} · 고객 ${applied?.patients_upserted??0} · 상담 ${applied?.consultations_upserted??0} · 수술/시술 ${applied?.procedures_upserted??0} · 제외 ${applied?.records_skipped??0}`);
  const {data,error:historyError}=await supabase.from('imports').select(historySelect).order('created_at',{ascending:false}).limit(5);
  if(!historyError)setHistory(data);
  onSaved?.();
 }catch(e){setMessage(e.code?connectionError(e):e.message);}finally{setBusy(false);}}
 async function applyImport(id){setBusy(true);setMessage('');try{
  const {data,error}=await supabase.rpc('apply_import',{p_import_id:id});if(error)throw error;
  setMessage(`본 DB 반영 완료 · 고객 ${data?.patients_upserted??0} · 상담 ${data?.consultations_upserted??0} · 수술/시술 ${data?.procedures_upserted??0} · 제외 ${data?.records_skipped??0}`);
  const {data:next,error:historyError}=await supabase.from('imports').select(historySelect).order('created_at',{ascending:false}).limit(5);
  if(!historyError)setHistory(next);
 }catch(e){setMessage(e.code?connectionError(e):e.message);}finally{setBusy(false);}}
 return <section className="card cloud"><div className="toolbar"><h2>Supabase 연결</h2><span className="badge">{ready?'연결 확인됨':session?'설정 확인 필요':'로그인 전'}</span></div><div className="plan-body">
 {!supabase?<p>상담 앱의 .env.local에 URL과 공개키를 설정해 주세요.</p>:!session?<form onSubmit={login} className="login"><label>이메일<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>비밀번호<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>로그인</button><p>상담 앱 권한이 있는 계정으로 로그인하세요. 로그인 없이도 로컬 엑셀 복원은 가능합니다.</p></form>:<><p>{session.user.email} <button disabled={busy} onClick={logout}>로그아웃</button></p><button disabled={!ready||busy||!sheet?.records?.length||!hash||sheet?.orphanRows?.length>0} onClick={save}>{busy?'저장 중…':'DB에 저장'}</button><p>버튼을 누르면 현재 시트가 Supabase에 저장되고 전체 자료 테이블에 반영됩니다. 미배정 행이 있는 시트는 저장할 수 없습니다.</p></>}
 {message&&<p role="status" className="notice">{message}</p>}{history.length>0&&<><h3>최근 저장</h3><ul>{history.map(h=><li key={h.id}>{h.file_name} · {h.sheet_name} · parser {h.parser_version} · {h.status} · {new Date(h.created_at).toLocaleString('ko-KR')} {h.result?.consultations_upserted!=null&&<span> · 상담 {h.result.consultations_upserted} · 제외 {h.result.records_skipped??0}</span>} {['staged','review'].includes(h.status)&&<button disabled={busy||!ready} onClick={()=>applyImport(h.id)}>마저 반영</button>}</li>)}</ul></>}
 </div></section>;
}
