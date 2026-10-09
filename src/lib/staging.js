export const PARSER_VERSION='0.3.2';
export async function fileHash(buffer){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function stagingPayload({fileName,hash,sheetName,records}){
 if(!/^[a-f0-9]{64}$/.test(hash??''))throw new Error('파일 해시가 없습니다. 파일을 다시 선택해 주세요.');
 if(!records?.length||records.length>2000)throw new Error('임시 저장은 1~2,000개 블록까지 가능합니다.');
 if(new TextEncoder().encode(JSON.stringify(records)).length>5*1024*1024)throw new Error('복원 자료가 임시 저장 한도 5MB를 초과했습니다.');
 return {p_file_name:fileName,p_file_sha256:hash,p_sheet_name:sheetName,p_parser_version:PARSER_VERSION,p_records:records};
}
export function connectionError(error){
 if(['PGRST106','PGRST202','42P01','3F000'].includes(error?.code))return '상담용 스키마 또는 함수가 아직 준비되지 않았습니다. SQL 적용과 consult 스키마 API 노출 설정이 필요합니다.';
 if(error?.code==='42501')return '상담 앱 접근 권한이 없습니다. 계정의 app_metadata.z_consult 권한을 확인해 주세요.';
 if(error?.message?.includes('Invalid login credentials'))return '이메일 또는 비밀번호를 확인해 주세요.';
 return '요청을 완료하지 못했습니다. 연결과 설정을 확인한 뒤 다시 시도해 주세요.';
}
