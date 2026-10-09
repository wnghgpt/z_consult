import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase=url&&key?createClient(url,key,{
 db:{schema:'consult'},
 auth:{storageKey:'z-consult-auth-v1',storage:window.sessionStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
}):null;
