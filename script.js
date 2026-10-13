// 接続情報は config.js (window.SUPABASE_URL / window.SUPABASE_KEY)
const $ = id => document.getElementById(id);
const store = { get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}} };
const COLORS = ['#FFC8D7','#FFE29A','#BFE8FF','#CDBEFF','#B7F0D4','#FFCDA8'];
const SHAPES = ['50%','42% 58% 55% 45% / 50% 45% 55% 50%','58% 42% 40% 60% / 55% 50% 50% 45%','46% 54% 60% 40% / 42% 58% 42% 58%'];
const hash = s => [...s].reduce((a,c)=>(a*31+c.codePointAt(0))>>>0,7);
const fmt = d => new Date(d).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
const onEnter = (el,fn) => el.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.isComposing){e.preventDefault();fn()} });
function blob(el,name){const h=hash(name);el.style.background=COLORS[h%COLORS.length];el.style.borderRadius=SHAPES[(h>>3)%SHAPES.length];el.textContent=[...name][0]||'?'}
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.id);toast.id=setTimeout(()=>t.hidden=true,4000)}
function setStatus(on,text){$('status').classList.toggle('on',on);$('statusText').textContent=text}

let sb, uid=null, me=store.get('kotoriba-name')||'', room=null, messages=[], channel=null, pending=null;
const feed=$('feed'), input=$('input'), sendBtn=$('send');

// ---------- 部屋の一覧 ----------
async function showLobby(){
  if(channel){sb.removeChannel(channel);channel=null}
  room=null;
  $('chat').hidden=true;$('lobby').hidden=false;$('back').hidden=true;$('settingsBtn').hidden=true;
  $('title').textContent='ことりば';$('sub').textContent='ひとことから始まる、みんなの部屋';
  const [r,m]=await Promise.all([
    sb.from('rooms').select('*').order('created_at',{ascending:false}),
    sb.from('room_members').select('room_id')
  ]);
  if(r.error){console.error(r.error);toast('部屋の一覧を読み込めませんでした: '+r.error.message);return}
  const joined=new Set((m.data||[]).map(x=>x.room_id));
  const box=$('rooms');box.textContent='';
  if(!r.data.length){
    const e=document.createElement('div');e.className='empty';e.style.margin='40px auto';
    e.innerHTML='<b>まだ部屋がありません</b>「部屋をつくる」から最初の部屋をつくりましょう。';
    box.append(e);return;
  }
  for(const x of r.data){
    const own=x.owner_id===uid, isIn=joined.has(x.id);
    const b=document.createElement('button');b.className='room'+(own?' own':'');
    const av=document.createElement('div');av.className='av';blob(av,x.name);
    const nm=document.createElement('span');nm.className='nm';nm.textContent=x.name;
    const tag=document.createElement('span');tag.className='tag';tag.textContent=own?'オーナー':isIn?'参加中':'パスワードあり';
    b.append(av,nm,tag);
    b.onclick=()=>isIn?openRoom(x):askPassword(x);
    box.append(b);
  }
}

// ---------- 部屋に入る ----------
function askPassword(r){
  pending=r;$('gateTitle').textContent=r.name;$('pwInput').value='';$('gateErr').textContent='';
  $('gate').showModal();$('pwInput').focus();
}
async function tryJoin(){
  const password=$('pwInput').value;
  if(!password||!pending)return;
  $('gateBtn').disabled=true;
  const {data,error}=await sb.rpc('join_room',{p_room:pending.id,p_password:password});
  $('gateBtn').disabled=false;
  if(error){console.error(error);$('gateErr').textContent='入室できませんでした: '+error.message;return}
  if(data!==true){$('gateErr').textContent='パスワードが違います。';$('pwInput').select();return}
  $('gate').close();openRoom(pending);
}

async function openRoom(r){
  room=r;messages=[];render();
  const owner=r.owner_id===uid;
  $('lobby').hidden=true;$('chat').hidden=false;$('back').hidden=false;$('settingsBtn').hidden=!owner;
  $('title').textContent=r.name;$('sub').textContent=owner?'あなたがオーナーの部屋':'参加中の部屋';
  const {data,error}=await sb.from('chat_messages').select('*').eq('room_id',r.id).order('created_at',{ascending:false}).limit(100);
  if(error){console.error(error);toast('メッセージを読み込めませんでした: '+error.message);return}
  if(!room||room.id!==r.id)return;
  messages=data.reverse();render();input.focus();
  channel=sb.channel('room-'+r.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'room_id=eq.'+r.id},p=>add(p.new))
    .subscribe(s=>{ if(s==='SUBSCRIBED')setStatus(true,'オンライン'); else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')setStatus(false,'再接続中') });
}

// ---------- メッセージ ----------
function render(){
  feed.textContent='';
  if(!messages.length){
    const e=document.createElement('div');e.className='empty';
    e.innerHTML='<b>まだ静かです</b>最初のひとことを送ってみましょう。';
    feed.append(e);return;
  }
  let prev=null;
  for(const m of messages){
    const mine=m.user_id===uid;
    const first=!prev||prev.user_id!==m.user_id||prev.name!==m.name||new Date(m.created_at)-new Date(prev.created_at)>180000;
    const row=document.createElement('div');
    row.className='row'+(mine?' me':'')+(first?' first':'');
    const av=document.createElement('div');av.className='av'+(first?'':' ghost');blob(av,m.name);
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

async function send(){
  const body=input.value.trim();
  if(!body||!room)return;
  input.value='';grow();sendBtn.disabled=true;
  const {error}=await sb.from('chat_messages').insert({room_id:room.id,name:me,body});
  if(error){console.error(error);input.value=body;grow();sendBtn.disabled=false;toast('送信できませんでした: '+error.message)}
}
function grow(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px'}
input.addEventListener('input',()=>{grow();sendBtn.disabled=!input.value.trim()});
onEnter(input,()=>$('form').requestSubmit());
$('form').addEventListener('submit',e=>{e.preventDefault();send()});

// ---------- 部屋をつくる ----------
function openMake(){
  $('roomName').value='';$('roomPw').value='';$('makeErr').textContent='';
  $('make').showModal();$('roomName').focus();
}
async function createRoom(){
  const name=$('roomName').value.trim(), pw=$('roomPw').value;
  if(!name){$('roomName').focus();return}
  if(pw.length<4){$('makeErr').textContent='パスワードは4文字以上にしてください。';return}
  $('makeBtn').disabled=true;
  const {data,error}=await sb.rpc('create_room',{p_name:name,p_password:pw});
  $('makeBtn').disabled=false;
  if(error){console.error(error);$('makeErr').textContent='作成できませんでした: '+error.message;return}
  $('make').close();
  const {data:r}=await sb.from('rooms').select('*').eq('id',data).single();
  if(r)openRoom(r);else showLobby();
}

// ---------- オーナー設定 ----------
function openCfg(){$('newPw').value='';$('kick').checked=false;$('cfgErr').textContent='';$('cfg').showModal()}
async function saveCfg(){
  const pw=$('newPw').value;
  if(pw.length<4){$('cfgErr').textContent='パスワードは4文字以上にしてください。';return}
  const {error}=await sb.rpc('set_room_password',{p_room:room.id,p_password:pw,p_kick:$('kick').checked});
  if(error){console.error(error);$('cfgErr').textContent='変更できませんでした: '+error.message;return}
  $('cfg').close();toast('パスワードを変更しました。');
}
async function deleteRoom(){
  if(!confirm('「'+room.name+'」を削除します。メッセージもすべて消え、元に戻せません。'))return;
  const {error}=await sb.from('rooms').delete().eq('id',room.id);
  if(error){console.error(error);$('cfgErr').textContent='削除できませんでした: '+error.message;return}
  $('cfg').close();toast('部屋を削除しました。');showLobby();
}

// ---------- 名前 ----------
function showName(){$('meText').textContent='名前: '+(me||'未設定')}
function askName(){$('nameInput').value=me;$('join').showModal();$('nameInput').focus()}
function setName(){
  const n=$('nameInput').value.trim();
  if(!n){$('nameInput').focus();return}
  me=n;store.set('kotoriba-name',n);showName();$('join').close();
}

// ---------- イベント ----------
$('back').onclick=showLobby;
$('settingsBtn').onclick=openCfg;
$('makeBtn0').onclick=openMake;
$('makeBtn').onclick=createRoom;$('makeCancel').onclick=()=>$('make').close();
onEnter($('roomPw'),createRoom);
$('gateBtn').onclick=tryJoin;$('gateCancel').onclick=()=>$('gate').close();
onEnter($('pwInput'),tryJoin);
$('cfgSave').onclick=saveCfg;$('cfgDelete').onclick=deleteRoom;$('cfgClose').onclick=()=>$('cfg').close();
$('renameBtn').onclick=askName;
$('joinBtn').onclick=setName;onEnter($('nameInput'),setName);
$('join').addEventListener('cancel',e=>{ if(!me)e.preventDefault() });

// ---------- 起動 ----------
(async()=>{
  showName();
  if(!window.SUPABASE_URL||!window.SUPABASE_KEY){toast('config.js に SUPABASE_URL と SUPABASE_KEY を設定してください。');setStatus(false,'未設定');return}
  sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_KEY,{db:{schema:'public'}});
  let {data:{session}}=await sb.auth.getSession();
  if(!session){
    const {data,error}=await sb.auth.signInAnonymously();
    if(error){console.error(error);toast('ログインできませんでした: '+error.message);setStatus(false,'未接続');return}
    session=data.session;
  }
  uid=session.user.id;setStatus(true,'オンライン');
  if(!me)askName();
  showLobby();
})();
