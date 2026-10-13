// 接続情報は config.js で window.SUPABASE_URL / window.SUPABASE_KEY として定義
const ROOM = 'lobby';

const demo = !window.SUPABASE_URL || !window.SUPABASE_KEY;
const sb = demo ? null : window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
const $ = id => document.getElementById(id);
const feed = $('feed'), input = $('input'), sendBtn = $('send');
let me = '', messages = [];

const store = { get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}} };

const COLORS = ['#FFC8D7','#FFE29A','#BFE8FF','#CDBEFF','#B7F0D4','#FFCDA8'];
const SHAPES = ['50%','42% 58% 55% 45% / 50% 45% 55% 50%','58% 42% 40% 60% / 55% 50% 50% 45%','46% 54% 60% 40% / 42% 58% 42% 58%'];
const hash = s => [...s].reduce((a,c)=>(a*31+c.codePointAt(0))>>>0,7);

function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.id);toast.id=setTimeout(()=>t.hidden=true,4000)}
function setStatus(on,text){$('status').classList.toggle('on',on);$('statusText').textContent=text}
const fmt = d => new Date(d).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});

function render(){
  feed.textContent='';
  if(!messages.length){
    const e=document.createElement('div');e.className='empty';
    e.innerHTML='<b>まだ静かです</b>最初のひとことを送ってみましょう。';
    feed.append(e);return;
  }
  let prev=null;
  for(const m of messages){
    const mine=m.name===me;
    const first=!prev||prev.name!==m.name||new Date(m.created_at)-new Date(prev.created_at)>180000;
    const row=document.createElement('div');
    row.className='row'+(mine?' me':'')+(first?' first':'');
    const h=hash(m.name);
    const av=document.createElement('div');
    av.className='av'+(first?'':' ghost');
    av.style.background=COLORS[h%COLORS.length];
    av.style.borderRadius=SHAPES[(h>>3)%SHAPES.length];
    av.textContent=[...m.name][0]||'?';
    const col=document.createElement('div');col.className='col';
    if(first&&!mine){const meta=document.createElement('div');meta.className='meta';meta.textContent=m.name;col.append(meta)}
    const b=document.createElement('div');b.className='bubble';b.textContent=m.body;col.append(b);
    const t=document.createElement('div');t.className='time';t.textContent=fmt(m.created_at);
    row.append(av,col,t);feed.append(row);
    prev=m;
  }
  feed.scrollTop=feed.scrollHeight;
}

function add(m){ if(m.id&&messages.some(x=>x.id===m.id))return; messages.push(m); render(); }

async function load(){
  if(demo){setStatus(false,'デモ');$('banner').hidden=false;render();return}
  const {data,error}=await sb.from('messages').select('*').eq('room',ROOM).order('created_at',{ascending:false}).limit(100);
  if(error){toast('メッセージを読み込めませんでした。URLとキーを確認してください。');setStatus(false,'未接続');return}
  messages=data.reverse();render();
  sb.channel('room-'+ROOM)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'room=eq.'+ROOM},p=>add(p.new))
    .subscribe(s=>{ if(s==='SUBSCRIBED')setStatus(true,'オンライン'); else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')setStatus(false,'再接続中') });
}

async function send(){
  const body=input.value.trim();
  if(!body)return;
  input.value='';grow();sendBtn.disabled=true;
  if(demo){add({id:crypto.randomUUID(),name:me,body,created_at:new Date().toISOString()});return}
  const {error}=await sb.from('messages').insert({room:ROOM,name:me,body});
  if(error){input.value=body;grow();sendBtn.disabled=false;toast('送信できませんでした。もう一度お試しください。')}
}

function grow(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px'}
input.addEventListener('input',()=>{grow();sendBtn.disabled=!input.value.trim()});
input.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('form').requestSubmit()} });
$('form').addEventListener('submit',e=>{e.preventDefault();send()});

function join(){
  const n=$('nameInput').value.trim();
  if(!n){$('nameInput').focus();return}
  me=n;store.set('kotoriba-name',n);$('join').close();input.focus();render();
}
$('joinBtn').addEventListener('click',join);
$('nameInput').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.isComposing){e.preventDefault();join()} });

me=store.get('kotoriba-name')||'';
load();
if(!me){$('join').showModal();$('nameInput').focus()}
