const SUPABASE_URL = "https://fmhfknlhyriiahywdcdc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_665mBiTJNWgKdZ3hTZVH5w_5tidUFTO";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const fileInput = document.getElementById('file-input');
const currentRoomLabel = document.getElementById('current-room-label');
const roomPassOverlay = document.getElementById('room-pass-overlay');
const roomPassInput = document.getElementById('room-pass-input');
const roomPassBtn = document.getElementById('room-pass-btn');
const roomPassClose = document.getElementById('room-pass-close');
const roomPassTitle = document.getElementById('room-pass-title');
const roomPassDesc = document.getElementById('room-pass-desc');
const roomPassError = document.getElementById('room-pass-error');
const togglePass = document.getElementById('toggle-pass');
const usernameOverlay = document.getElementById('username-overlay');
const usernameInput = document.getElementById('username-input');
const usernameBtn = document.getElementById('username-btn');
const avatarInput = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');

let currentRoom = localStorage.getItem('last_room') || "general";
let currentUser = localStorage.getItem('fed_name') || null;
let currentAvatar = localStorage.getItem('chat_avatar') || null;
let currentUserId = null;
let pendingRoom = null, pendingMode = null, realtimeChannel = null;
let pendingFile = null, pendingReply = null;

function getStoredRoomHash(roomName){ return localStorage.getItem(`room_hash_${roomName}`) || ""; }
function setStoredRoomHash(roomName, hash){ localStorage.setItem(`room_hash_${roomName}`, hash); }

async function ensureAuth(){
  let { data:{session} } = await supabaseClient.auth.getSession();
  if(!session){ const {data,error} = await supabaseClient.auth.signInAnonymously(); if(error) throw error; session=data.session; }
  currentUserId=session.user.id; return session.user;
}
ensureAuth().then(()=>{ if(currentUser && usernameOverlay){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; loadMessages(); connectToRealtimeStream(); }});

function saveJoinedRoom(roomName){ let rooms=[]; try{rooms=JSON.parse(localStorage.getItem('joined_rooms')||'[]')}catch{} if(!rooms.includes(roomName)){rooms.push(roomName); localStorage.setItem('joined_rooms',JSON.stringify(rooms))} localStorage.setItem('last_room',roomName); }
function formatTime(d){ const date=new Date(d); const diff=Math.floor((new Date()-date)/86400000); let dp=diff===0?"Today":diff===1?"Yesterday":date.toLocaleDateString([],{day:'2-digit',month:'short'}); return `${dp} • ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`; }
async function hashPass(pass){ const enc=new TextEncoder().encode(pass); const buf=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

// --- SECURE VERSION - NO FALLBACK - YOUR REQUESTED VERSION ---
async function loadMessages(){
  const hashedPass = getStoredRoomHash(currentRoom);
  if(!hashedPass){
    if(chatMessages) chatMessages.innerHTML = "<div style='padding:30px;text-align:center;color:#888'>🔒 This room is private. Enter password to view.</div>";
    return;
  }
  const { data, error } = await supabaseClient.rpc('get_messages_secure', {
    room_name: currentRoom,
    pass_hash: hashedPass
  });
  if(error){
    console.error(error);
    return;
  }
  if(chatMessages) chatMessages.innerHTML="";
  data.forEach(m=> appendMessageToFeed(m.text,m.file_url,m.file_type,m.sender_name,m.avatar_url,m.sender_id===currentUserId,m.created_at,m.id,m.sender_id));
  updateChatHeader(); setupPresence();
}

window.sendSticker = async function(sticker){
  await ensureAuth();
  const isUrl = typeof sticker === 'string' && sticker.startsWith('http');
  await supabaseClient.from('messages').insert([{
    text: isUrl? "" : sticker,
    file_url: isUrl? sticker : null,
    file_type: isUrl? "image/gif" : null,
    room_id: currentRoom,
    sender_name: currentUser,
    avatar_url: currentAvatar,
    sender_id: currentUserId
  }]);
}

// --- FIXED FILE PREVIEW - SHOWS WHERE IT SHOULD ---
function ensureFilePreviewBox(){
  if(document.getElementById('file-preview-box')) return document.getElementById('file-preview-box');
  const bottomBar = document.querySelector('.bottom-bar');
  if(!bottomBar) return null;
  const html = `<div id="file-preview-box" style="display:none; position:absolute; bottom:100%; left:0; right:0; background:white; border-top:1px solid #ddd; padding:10px; align-items:center; gap:10px; z-index:9996;"><img id="file-preview-img" src="" style="width:60px; height:60px; object-fit:cover; border-radius:8px; display:none;"><div style="flex:1;"><div id="file-preview-name" style="font-weight:bold; font-size:13px;"></div><div id="file-preview-size" style="font-size:11px; color:#888;"></div></div><button id="file-preview-cancel" type="button" style="background:#eee; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer;">×</button></div>`;
  bottomBar.insertAdjacentHTML('beforebegin', html);
  bottomBar.style.position = 'relative';
  document.getElementById('file-preview-cancel').onclick = clearFilePreview;
  return document.getElementById('file-preview-box');
}
function showFilePreview(file){
  const box = ensureFilePreviewBox();
  if(!box) return;
  pendingFile = file;
  const nameEl = document.getElementById('file-preview-name');
  const sizeEl = document.getElementById('file-preview-size');
  const imgEl = document.getElementById('file-preview-img');
  nameEl.textContent = file.name;
  sizeEl.textContent = (file.size/1024/1024).toFixed(2) + " MB • " + (file.type||'file');
  if(file.type.startsWith('image/')){
    imgEl.style.display='block';
    imgEl.src = URL.createObjectURL(file);
  } else {
    imgEl.style.display='none';
  }
  box.style.display='flex';
}
function clearFilePreview(){
  pendingFile = null;
  if(fileInput) fileInput.value="";
  const box = document.getElementById('file-preview-box');
  if(box) box.style.display='none';
  const img = document.getElementById('file-preview-img');
  if(img) img.src="";
}

function appendMessageToFeed(text,fileUrl,fileType,senderName,avatarUrl,isOwn=false,createdAt=null,messageId=null,senderId=null){
  if(!chatMessages) return;
  const row=document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end'; row.style.maxWidth='75%'; row.style.alignSelf=isOwn?'flex-end':'flex-start'; if(isOwn) row.style.marginLeft='auto';
  let avatarEl; if(avatarUrl){ avatarEl=document.createElement('img'); avatarEl.src=avatarUrl; avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;'; } else { avatarEl=document.createElement('div'); avatarEl.textContent=(senderName||'?').charAt(0).toUpperCase(); avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;background:#4a148c;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;'; }
  const bubble=document.createElement('div'); bubble.classList.add('message',isOwn?'outgoing':'incoming'); if(messageId) bubble.setAttribute('data-id',messageId);
  if(!isOwn && senderName){ const b=document.createElement('b'); b.textContent=senderName; b.style.cssText='font-size:12px;color:#075e54;display:block;margin-bottom:2px;'; bubble.appendChild(b); }
  if(text){ const s=document.createElement('div'); s.textContent=text; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; bubble.appendChild(s); }
  if(fileUrl){
    if(fileType?.startsWith('image/') || fileUrl.includes('.gif') || fileUrl.includes('tenor.com') || fileUrl.includes('giphy.com')){ const img=document.createElement('img'); img.src=fileUrl; img.style.cssText='max-width:200px;border-radius:12px;margin-top:5px;cursor:pointer;'; bubble.appendChild(img); }
    else if(fileType?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=fileUrl; a.controls=true; a.style.cssText='max-width:220px;margin-top:6px;'; bubble.appendChild(a); }
    else { const a=document.createElement('a'); a.href=fileUrl; a.target='_blank'; a.textContent='📄 '+(text||'Download File'); bubble.appendChild(a); }
  }
  const meta=document.createElement('div'); meta.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:4px;';
  const timeSpan=document.createElement('span'); timeSpan.textContent=formatTime(createdAt||new Date()); timeSpan.style.fontSize='10px'; meta.appendChild(timeSpan);
  if(isOwn && messageId){ const del=document.createElement('span'); del.textContent='× Delete'; del.style.cursor='pointer'; del.style.fontSize='11px'; del.onclick=async()=>{ if(confirm("Delete?")) await supabaseClient.from('messages').delete().eq('id',messageId); }; meta.appendChild(del); }
  bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}

async function sendMessage(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return; }
  await ensureAuth(); let finalText = chatInput?.value.trim() || "";
  if(pendingFile){
    const file=pendingFile; const caption=finalText||file.name; sendBtn.textContent="..."; sendBtn.disabled=true;
    try{ const fileName=`${currentRoom}/${currentUserId}_${Date.now()}_${file.name}`; const {error}=await supabaseClient.storage.from('chat-files').upload(fileName,file); if(error) throw error; const {data}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName); await supabaseClient.from('messages').insert([{ text:caption, room_id:currentRoom, file_url:data.publicUrl, file_type:file.type, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); if(chatInput) chatInput.value=""; clearFilePreview(); }catch(err){ alert(err.message); } sendBtn.textContent="Send"; sendBtn.disabled=false; return;
  }
  if(!finalText) return; if(chatInput) chatInput.value="";
  const {error}=await supabaseClient.from('messages').insert([{ text:finalText, room_id:currentRoom, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); if(error) alert(error.message);
}

async function attemptJoinRoom(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return alert("Enter your name first"); }
  const name=(roomInput?.value.trim()||"") || (document.getElementById('drawer-room-input')?.value.trim()||""); if(!name) return alert("Enter room name"); pendingRoom=name;
  const {data}=await supabaseClient.from('rooms').select('*').eq('id',name).maybeSingle();
  if(!data){ pendingMode='create'; roomPassTitle.textContent='Create Password'; roomPassDesc.textContent=`"${name}" is new. Set password`; } else { pendingMode='join'; roomPassTitle.textContent='Enter Password'; roomPassDesc.textContent=`"${name}" is private`; }
  roomPassInput.value=""; roomPassError.textContent=""; roomPassOverlay.classList.remove('hidden');
}

async function confirmRoomPassword(){
  const pass=roomPassInput?.value.trim()||""; if(!pass){ roomPassError.textContent="Enter password"; return; }
  roomPassBtn.textContent="Checking..."; roomPassBtn.disabled=true;
  const hashed=await hashPass(pass);
  if(pendingMode==='create'){
    const {error}=await supabaseClient.from('rooms').insert([{id:pendingRoom, password_hash:hashed}]);
    if(error){ roomPassError.textContent=error.message; roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; return; }
  } else {
    const {data}=await supabaseClient.from('rooms').select('*').eq('id',pendingRoom).eq('password_hash',hashed).maybeSingle();
    if(!data){ roomPassError.textContent="Wrong password!"; roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; return; }
  }
  currentRoom=pendingRoom; setStoredRoomHash(currentRoom, hashed); localStorage.setItem(`room_pass_${currentRoom}`, pass); saveJoinedRoom(currentRoom);
  roomPassOverlay.classList.add('hidden'); roomPassBtn.textContent="Join Room"; roomPassBtn.disabled=false;
  loadMessages(); connectToRealtimeStream();
}

function connectToRealtimeStream(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel(`chat-${currentRoom}`)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${currentRoom}`},p=>{ const isOwn=p.new.sender_id===currentUserId; appendMessageToFeed(p.new.text,p.new.file_url,p.new.file_type,p.new.sender_name,p.new.avatar_url,isOwn,p.new.created_at,p.new.id,p.new.sender_id); })
 .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{ const el=chatMessages?.querySelector(`[data-id="${p.old.id}"]`); if(el?.parentElement) el.parentElement.remove(); })
 .subscribe(); setupPresence();
}

async function setupPresence(){}
function updateChatHeader(){ const name=localStorage.getItem('fed_name')||currentUser||'Guest'; const room=currentRoom; if(currentRoomLabel) currentRoomLabel.textContent=`Room: ${room} | You: ${name}`; if(chatInput){ chatInput.value=""; chatInput.placeholder=`${name} • #${room} > Type a message...`; } }
if(joinBtn) joinBtn.addEventListener('click',attemptJoinRoom);
if(roomPassBtn) roomPassBtn.addEventListener('click',confirmRoomPassword);
if(roomPassClose) roomPassClose.addEventListener('click',()=> roomPassOverlay.classList.add('hidden'));
if(sendBtn) sendBtn.addEventListener('click',sendMessage);
if(chatInput) chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); } });

// --- FIXED: Attach + File + Google ---
const attachBtn = document.getElementById('attach-btn');
if(attachBtn && fileInput){ attachBtn.onclick = ()=> fileInput.click(); }

if(fileInput){
  fileInput.addEventListener('change', ()=>{
    const f=fileInput.files[0];
    if(!f) return;
    showFilePreview(f);
    if(chatInput) chatInput.focus();
  });
}
if(togglePass) togglePass.addEventListener('click',()=>{ roomPassInput.type=roomPassInput.type==='password'?'text':'password'; togglePass.textContent=roomPassInput.type==='password'?'👁️':'🙈'; });

// FIXED AVATAR PREVIEW - NOW SHOWS IMMEDIATELY
if(avatarInput){
  avatarInput.addEventListener('change', ()=>{
    const f=avatarInput.files[0];
    if(!f ||!avatarPreview) return;
    avatarPreview.src = URL.createObjectURL(f);
    avatarPreview.style.display = 'block';
  });
}

// FIXED GOOGLE - SHOWS PHOTO INSTEAD OF?
function handleGoogle(res){
  try{
    const data = JSON.parse(atob(res.credential.split('.')[1]));
    if(usernameInput) usernameInput.value = data.name;
    const gmailInput = document.getElementById('p_gmail');
    if(gmailInput) gmailInput.value = data.email;
    if(avatarPreview){
      avatarPreview.src = data.picture;
      avatarPreview.style.display = 'block';
      avatarPreview.onerror = ()=>{ avatarPreview.src = `https://via.placeholder.com/100/4a148c/ffffff?text=${data.name.charAt(0)}`; };
    }
    localStorage.setItem('fed_pic', data.picture);
    localStorage.setItem('fed_email', data.email);
    localStorage.setItem('fed_name', data.name);
  }catch(e){ console.error(e); }
}

if(usernameBtn){
  usernameBtn.addEventListener('click', async ()=>{
    const name=usernameInput.value.trim(); const gender=document.getElementById('p_gender')?.value||''; if(!name) return alert("Enter name"); if(!gender) return alert("Select gender");
    await ensureAuth(); let avatarUrl=currentAvatar; const file=avatarInput?.files[0]; if(file){ const fn=`${currentUserId}_${Date.now()}_${file.name}`; const {error}=await supabaseClient.storage.from('avatars').upload(fn,file); if(!error){ const {data}=supabaseClient.storage.from('avatars').getPublicUrl(fn); avatarUrl=data.publicUrl; }} else if(localStorage.getItem('fed_pic')){ avatarUrl = localStorage.getItem('fed_pic'); }
    currentUser=name; currentAvatar=avatarUrl; localStorage.setItem('chat_username',name); localStorage.setItem('fed_name',name); localStorage.setItem('fed_gender',gender); if(avatarUrl) localStorage.setItem('chat_avatar',avatarUrl);
    await supabaseClient.from('user_profiles').upsert([{ id:currentUserId, username:name, avatar_url:avatarUrl, gender }],{onConflict:'id'});
    usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; updateChatHeader(); loadMessages(); connectToRealtimeStream();
  });
}