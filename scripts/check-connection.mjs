import {readFile} from 'node:fs/promises';
const env=Object.fromEntries((await readFile(new URL('../.env.local',import.meta.url),'utf8')).split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
try{
 const response=await fetch(env.VITE_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(15000)});
 console.log(JSON.stringify({check:'auth settings',status:response.status,connected:response.ok}));
 if(!response.ok)process.exitCode=1;
}catch(e){console.error('Connection failed:',e.cause?.code??e.name);process.exitCode=1;}
