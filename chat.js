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
const generalBtn = document.getElementById('general-btn');
const changeProfileBtn = document.getElementById('change-profile-btn');
const communitiesBtn = document.getElementById('communities-btn');
const communitiesPopup = document.getElementById('communities-popup');
const replyPreview = document.getElementById('reply-preview');
const replyToName = document.getElementById('reply-to-name');
const replyToText = document.getElementById('reply-to-text');
const replyCancel = document.getElementById('reply-cancel');

let currentRoom = localStorage.getItem('last_room') || "general";
let currentUser = localStorage.getItem('fed_name') || null;
let currentAvatar = localStorage.getItem('chat_avatar') || null;
let currentUserId = null;
let pendingRoom = null, pendingMode = null, realtimeChannel = null;
let presenceChannel = null;
let pendingFile = null;
let pendingReply = null;

function getStoredRoomHash(roomName){ return localStorage.getItem(`room_hash_${roomName}`) || ""; }
function setStoredRoomHash(roomName, hash){ localStorage.setItem(`room_hash_${roomName}`, hash); }
function getJoinedRooms(){ try{ return JSON.parse(localStorage.getItem('joined_rooms')||'[]'); }catch{ return []; } }

async function ensureAuth(){
  let { data:{session} } = await supabaseClient.auth.getSession();
  if(!session){ const {data,error} = await supabaseClient.auth.signInAnonymously(); if(error) throw error; session=data.session; }
  currentUserId=session.user.id; return session.user;
}
ensureAuth().then(()=>{ if(currentUser){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; loadMessages(); connectToRealtimeStream(); }});

function saveJoinedRoom(roomName){ let rooms=getJoinedRooms(); if(!rooms.includes(roomName)){rooms.push(roomName); localStorage.setItem('joined_rooms',JSON.stringify(rooms))} localStorage.setItem('last_room',roomName); }
function formatTime(d){ const date=new Date(d); const diff=Math.floor((new Date()-date)/86400000); let dp=diff===0?"Today":diff===1?"Yesterday":date.toLocaleDateString([],{day:'2-digit',month:'short'}); return `${dp} • ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`; }
async function hashPass(pass){ const enc=new TextEncoder().encode(pass); const buf=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

// --- CHIME + ALERT (NO CSP BLOCK) ---
let chimeAudio = document.getElementById('chime-audio');
if(!chimeAudio){
  chimeAudio = new Audio();
  chimeAudio.src = "https://cdn.freesound.org/previews/131/131142_2337290-lq.mp3";
  chimeAudio.volume = 0.6;
}
let audioUnlocked = false;
function unlockAudio(){ if(!audioUnlocked){ chimeAudio.play().then(()=>{ chimeAudio.pause(); chimeAudio.currentTime=0; }).catch(()=>{}); audioUnlocked=true; } }
document.addEventListener('click', unlockAudio, {once:true});

let originalTitle = document.title;
let unreadCount = 0;
function playChime(){
  if(!chimeAudio) return;
  chimeAudio.currentTime = 0;
  chimeAudio.play().catch(()=>{});
  if(navigator.vibrate) navigator.vibrate([100,50,100]);
}
function flashTitle(){
  if(document.hidden){
    unreadCount++;
    document.title = `(${unreadCount}) New message • ${originalTitle}`;
  }
}
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden){ unreadCount = 0; document.title = originalTitle; }
});

async function loadMessages(){
  let hashedPass = getStoredRoomHash(currentRoom);
  if(currentRoom === "general"){ hashedPass = ""; }
  if(!hashedPass && currentRoom!== "general"){
    if(chatMessages) chatMessages.innerHTML = "<div style='padding:30px;text-align:center;color:#888'>🔒 Private room. Enter password.</div>";
    return;
  }
  const { data, error } = await supabaseClient.rpc('get_messages_secure', { room_name: currentRoom, pass_hash: hashedPass });
  if(error){ console.error(error); return; }
  if(chatMessages) chatMessages.innerHTML="";
  (data||[]).forEach(m=> appendMessageToFeed(m));
  updateChatHeader();
}

window.sendSticker = async function(sticker){
  await ensureAuth();
  unlockAudio();
  const isUrl = sticker.startsWith('http');
  let payload = { text: isUrl? "" : sticker, file_url: isUrl? sticker : null, file_type: isUrl? "image/gif" : null, room_id: currentRoom, sender_name: currentUser, avatar_url: currentAvatar, sender_id: currentUserId };
  if(pendingReply){
    payload.reply_to_name = pendingReply.name;
    payload.reply_to_text = pendingReply.text;
  }
  const { error } = await supabaseClient.from('messages').insert([payload]);
  if(error && error.message.includes('reply_to')){
    delete payload.reply_to_name; delete payload.reply_to_text; delete payload.reply_to_id;
    await supabaseClient.from('messages').insert([payload]);
  }
  clearReply();
}

function ensureFilePreviewBox(){
  let box = document.getElementById('file-preview-box');
  if(box) return box;
  const bottomBar = document.querySelector('.bottom-bar');
  if(!bottomBar) return null;
  bottomBar.insertAdjacentHTML('beforebegin', `<div id="file-preview-box" style="display:none; position:absolute; bottom:100%; left:0; right:0; background:white; border-top:1px solid #ddd; padding:10px; align-items:center; gap:10px; z-index:9996;"><img id="file-preview-img" src="" style="width:60px; height:60px; object-fit:cover; border-radius:8px; display:none;"><div style="flex:1;"><div id="file-preview-name" style="font-weight:bold; font-size:13px;"></div><div id="file-preview-size" style="font-size:11px; color:#888;"></div></div><button id="file-preview-cancel" type="button" style="background:#eee; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer;">×</button></div>`);
  box = document.getElementById('file-preview-box');
  document.getElementById('file-preview-cancel').onclick = clearFilePreview;
  return box;
}
function showFilePreview(file){
  const box = ensureFilePreviewBox();
  if(!box) return;
  pendingFile = file;
  document.getElementById('file-preview-name').textContent = file.name;
  document.getElementById('file-preview-size').textContent = (file.size/1024/1024).toFixed(2) + " MB";
  const img = document.getElementById('file-preview-img');
  if(file.type.startsWith('image/')){ img.style.display='block'; img.src = URL.createObjectURL(file); } else { img.style.display='none'; }
  box.style.display='flex';
}
function clearFilePreview(){
  pendingFile = null;
  if(fileInput) fileInput.value="";
  const box = document.getElementById('file-preview-box');
  if(box) box.style.display='none';
}

// REPLY - FIXED
function setReply(id, name, text){
  pendingReply = {id, name, text: (text||'File').substring(0,120)};
  if(replyToName) replyToName.textContent = "Replying to " + name;
  if(replyToText) replyToText.textContent = text||'File';
  if(replyPreview){
    replyPreview.classList.remove('hidden');
    replyPreview.style.display = 'flex';
  }
  chatInput?.focus();
}
function clearReply(){
  pendingReply = null;
  if(replyPreview){
    replyPreview.classList.add('hidden');
    replyPreview.style.display = 'none';
  }
}
if(replyCancel) replyCancel.onclick = clearReply;

function appendMessageToFeed(m){
  if(!m ||!chatMessages) return;
  const text = m.text; const fileUrl = m.file_url; const fileType = m.file_type; const senderName = m.sender_name; const avatarUrl = m.avatar_url; const isOwn = m.sender_id===currentUserId; const createdAt = m.created_at; const messageId = m.id; const replyToNameVal = m.reply_to_name; const replyToTextVal = m.reply_to_text;
  const row=document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end'; row.style.maxWidth='78%'; row.style.alignSelf=isOwn?'flex-end':'flex-start'; if(isOwn) row.style.marginLeft='auto'; row.dataset.id = messageId||'';
  let avatarEl; if(avatarUrl){ avatarEl=document.createElement('img'); avatarEl.src=avatarUrl; avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0; cursor:pointer;'; } else { avatarEl=document.createElement('div'); avatarEl.textContent=(senderName||'?').charAt(0).toUpperCase(); avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;background:#4a148c;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0; cursor:pointer;'; }
  avatarEl.onclick = ()=> showUserProfile(m.sender_id, senderName, avatarUrl);
  const bubble=document.createElement('div'); bubble.style.cssText = `background:${isOwn? '#e8dafa':'white'}; color:#1a1a1a; padding:8px 12px; border-radius:12px; box-shadow:0 1px 1px rgba(0,0,0,0.1); position:relative; max-width:100%;`; if(messageId) bubble.setAttribute('data-id',messageId);
  if(replyToNameVal){
    const quote=document.createElement('div'); quote.style.cssText='border-left:3px solid #4a148c; background:rgba(0,0,0,0.06); padding:5px 8px; margin-bottom:6px; border-radius:4px;'; quote.innerHTML=`<div style="font-size:11px; font-weight:bold; color:#4a148c;">${replyToNameVal}</div><div style="font-size:11px; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${replyToTextVal||''}</div>`; bubble.appendChild(quote);
  }
  if(!isOwn && senderName){ const b=document.createElement('b'); b.textContent=senderName; b.style.cssText='font-size:12px;color:#075e54;display:block;margin-bottom:2px; cursor:pointer;'; b.onclick=()=> showUserProfile(m.sender_id, senderName, avatarUrl); bubble.appendChild(b); }
  if(text){ const s=document.createElement('div'); s.textContent=text; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; s.style.fontSize='14px'; bubble.appendChild(s); }
  if(fileUrl){
    if(fileType?.startsWith('image/') || fileUrl.includes('tenor') || fileUrl.includes('giphy')){ const img=document.createElement('img'); img.src=fileUrl; img.style.cssText='max-width:200px;border-radius:12px;margin-top:5px;cursor:pointer;display:block;'; bubble.appendChild(img); }
    else if(fileType?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=fileUrl; a.controls=true; a.style.cssText='max-width:220px;margin-top:6px;'; bubble.appendChild(a); }
    else { const a=document.createElement('a'); a.href=fileUrl; a.target='_blank'; a.textContent='📄 '+(text||'Download'); bubble.appendChild(a); }
  }
  const meta=document.createElement('div'); meta.style.cssText='display:flex;justify-content:flex-end;gap:10px;margin-top:4px; align-items:center;';
  const timeSpan=document.createElement('span'); timeSpan.textContent=formatTime(createdAt||new Date()); timeSpan.style.fontSize='10px'; timeSpan.style.color='#888'; meta.appendChild(timeSpan);
  const replyBtn=document.createElement('span'); replyBtn.textContent='Reply'; replyBtn.style.cssText='cursor:pointer; font-size:11px; color:#4a148c; font-weight:700; background:#f0eaff; padding:2px 6px; border-radius:10px;'; replyBtn.onclick=()=> setReply(messageId, senderName, text || 'File'); meta.appendChild(replyBtn);
  if(isOwn && messageId){ const del=document.createElement('span'); del.textContent='×'; del.style.cursor='pointer'; del.style.fontSize='14px'; del.style.color='#c00'; del.onclick=async()=>{ if(confirm("Delete?")) await supabaseClient.from('messages').delete().eq('id',messageId); }; meta.appendChild(del); }
  bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}

async function sendMessage(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return; }
  await ensureAuth();
  unlockAudio();
  let finalText = chatInput?.value.trim() || "";
  if(pendingFile){
    const file=pendingFile; const caption=finalText||file.name; sendBtn.textContent="..."; sendBtn.disabled=true;
    try{
      const fileName=`${currentRoom}/${currentUserId}_${Date.now()}_${file.name}`;
      const {error}=await supabaseClient.storage.from('chat-files').upload(fileName,file); if(error) throw error;
      const {data}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
      let payload = { text:caption, room_id:currentRoom, file_url:data.publicUrl, file_type:file.type, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId, reply_to_id: pendingReply?.id||null, reply_to_name: pendingReply?.name||null, reply_to_text: pendingReply?.text||null };
      let res = await supabaseClient.from('messages').insert([payload]);
      if(res.error && res.error.message.includes('reply_to')){
        delete payload.reply_to_id; delete payload.reply_to_name; delete payload.reply_to_text;
        await supabaseClient.from('messages').insert([payload]);
      }
      if(chatInput) chatInput.value=""; clearFilePreview(); clearReply();
    }catch(err){ alert(err.message); }
    sendBtn.textContent="Send"; sendBtn.disabled=false; return;
  }
  if(!finalText) return;
  if(chatInput) chatInput.value="";
  let payload = { text:finalText, room_id:currentRoom, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId, reply_to_id: pendingReply?.id||null, reply_to_name: pendingReply?.name||null, reply_to_text: pendingReply?.text||null };
  let { error } = await supabaseClient.from('messages').insert([payload]);
  if(error && error.message.toLowerCase().includes('reply_to')){
    delete payload.reply_to_id; delete payload.reply_to_name; delete payload.reply_to_text;
    const retry = await supabaseClient.from('messages').insert([payload]);
    if(retry.error) alert("DB needs reply columns: run SQL I gave you. Error: "+retry.error.message);
  } else if(error){
    alert(error.message);
  }
  clearReply();
}

async function attemptJoinRoom(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return alert("Enter your name first"); }
  const name=(roomInput?.value.trim()||"") || (document.getElementById('drawer-room-input')?.value.trim()||""); if(!name) return alert("Enter room name"); pendingRoom=name;
  if(name === "general"){ joinGeneral(); return; }
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
  currentRoom=pendingRoom; setStoredRoomHash(currentRoom, hashed); saveJoinedRoom(currentRoom);
  roomPassOverlay.classList.add('hidden'); roomPassBtn.textContent="Join Room"; roomPassBtn.disabled=false;
  loadMessages(); connectToRealtimeStream();
}

// --- FIXED PART ONLY - ONLINE PRESENCE ---
function updateOnlineUI(users){
  const countEl = document.getElementById('online-number');
  const countDrawer = document.getElementById('online-number-drawer');
  const container = document.getElementById('online-users-container');
  const containerDrawer = document.getElementById('online-users-container-drawer');
  const count = users.length;
  if(countEl) countEl.textContent = count + (count===1? " online" : " online");
  if(countDrawer) countDrawer.textContent = count;
  const html = users.map(u => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 8px; background:#f9f5ff; border-radius:10px;">
      <img src="${u.avatar||'https://via.placeholder.com/40/4a148c/fff?text='+encodeURIComponent(u.name.charAt(0))}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;">
      <div style="flex:1;"><div style="font-size:13px; font-weight:600;">${u.name}</div><div style="font-size:11px; color:#00c853;">● Online</div></div>
    </div>
  `).join('');
  if(container) container.innerHTML = html || "<div style='padding:20px; text-align:center; color:#888; font-size:13px;'>No one online yet</div>";
  if(containerDrawer) containerDrawer.innerHTML = html || "<div style='color:#bbb; font-size:12px;'>No one online</div>";
}

function connectToRealtimeStream(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  if(presenceChannel) supabaseClient.removeChannel(presenceChannel);

  realtimeChannel=supabaseClient.channel(`chat-${currentRoom}`)
.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${currentRoom}`},p=>{
    appendMessageToFeed(p.new);
    if(p.new.sender_id!== currentUserId){
      playChime();
      flashTitle();
    }
  })
.on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{
    const el=chatMessages?.querySelector(`[data-id="${p.old.id}"]`);
    if(el){ const row = el.closest('div[data-id]') || el.parentElement?.parentElement || el.parentElement; if(row) row.remove(); }
  })
.subscribe();

  presenceChannel = supabaseClient.channel(`presence-${currentRoom}`, { config: { presence: { key: currentUserId } } });
  presenceChannel.on('presence', { event: 'sync' }, () => {
    const state = presenceChannel.presenceState();
    const users = [];
    for (const id in state) {
      state[id].forEach(p => users.push(p));
    }
    updateOnlineUI(users);
  });
  presenceChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({
        id: currentUserId,
        name: currentUser || 'Guest',
        avatar: currentAvatar || null,
        room: currentRoom
      });
    }
  });
}

function updateChatHeader(){ const name=localStorage.getItem('fed_name')||currentUser||'Guest'; const room=currentRoom; if(currentRoomLabel) currentRoomLabel.textContent=`Room: ${room} | You: ${name}`; if(chatInput) chatInput.placeholder=`${name} • #${room} > Type...`; }
function joinGeneral(){
  currentRoom = "general";
  localStorage.setItem('last_room', 'general');
  if(document.getElementById('mobile-drawer')) document.getElementById('mobile-drawer').classList.remove('open');
  const bd = document.getElementById('drawer-backdrop'); if(bd) bd.classList.remove('open');
  loadMessages(); connectToRealtimeStream();
}

if(changeProfileBtn){
  changeProfileBtn.onclick = ()=>{
    usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex';
    if(usernameInput) usernameInput.value = localStorage.getItem('fed_name')||'';
    const gSel = document.getElementById('p_gender'); if(gSel) gSel.value = localStorage.getItem('fed_gender')||'';
    const gMail = document.getElementById('p_gmail'); if(gMail) gMail.value = localStorage.getItem('fed_email')||'';
    if(currentAvatar && avatarPreview) avatarPreview.src = currentAvatar;
  };
}
if(generalBtn) generalBtn.onclick = joinGeneral;
const drawerGeneral = document.getElementById('drawer-general'); if(drawerGeneral) drawerGeneral.onclick = joinGeneral;
if(joinBtn) joinBtn.addEventListener('click',attemptJoinRoom);
if(roomPassBtn) roomPassBtn.addEventListener('click',confirmRoomPassword);
if(sendBtn) sendBtn.addEventListener('click',sendMessage);
if(chatInput) chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); } });
const attachBtn = document.getElementById('attach-btn'); if(attachBtn && fileInput){ attachBtn.onclick = ()=> fileInput.click(); }
if(fileInput){ fileInput.addEventListener('change', ()=>{ const f=fileInput.files[0]; if(!f) return; showFilePreview(f); }); }
if(togglePass) togglePass.addEventListener('click',()=>{ roomPassInput.type=roomPassInput.type==='password'?'text':'password'; togglePass.textContent=roomPassInput.type==='password'?'👁️':'🙈'; });
if(avatarInput){ avatarInput.addEventListener('change', ()=>{ const f=avatarInput.files[0]; if(!f||!avatarPreview) return; avatarPreview.src = URL.createObjectURL(f); }); }
function handleGoogle(res){ try{ const data=JSON.parse(atob(res.credential.split('.')[1])); if(usernameInput) usernameInput.value=data.name; const gmailInput=document.getElementById('p_gmail'); if(gmailInput) gmailInput.value=data.email; if(avatarPreview) avatarPreview.src=data.picture; localStorage.setItem('fed_pic',data.picture); localStorage.setItem('fed_email',data.email); localStorage.setItem('fed_name',data.name); }catch(e){} }
if(usernameBtn){
  usernameBtn.addEventListener('click', async ()=>{
    const name=usernameInput.value.trim(); const gender=document.getElementById('p_gender')?.value||''; if(!name) return alert("Enter name"); if(!gender) return alert("Select gender");
    await ensureAuth(); let avatarUrl=currentAvatar; const file=avatarInput?.files[0]; if(file){ const fn=`${currentUserId}_${Date.now()}_${file.name}`; const {error}=await supabaseClient.storage.from('avatars').upload(fn,file); if(!error){ const {data}=supabaseClient.storage.from('avatars').getPublicUrl(fn); avatarUrl=data.publicUrl; }} else if(localStorage.getItem('fed_pic')){ avatarUrl=localStorage.getItem('fed_pic'); }
    currentUser=name; currentAvatar=avatarUrl; localStorage.setItem('fed_name',name); localStorage.setItem('fed_gender',gender); if(avatarUrl) localStorage.setItem('chat_avatar',avatarUrl);
    await supabaseClient.from('user_profiles').upsert([{ id:currentUserId, username:name, avatar_url:avatarUrl, gender }],{onConflict:'id'});
    usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; updateChatHeader(); loadMessages(); connectToRealtimeStream();
  });
}
if(roomPassOverlay){ roomPassOverlay.addEventListener('click', (e)=>{ if(e.target===roomPassOverlay) roomPassOverlay.classList.add('hidden'); }); }
if(roomPassClose) roomPassClose.addEventListener('click',()=> roomPassOverlay.classList.add('hidden'));
if(usernameOverlay){ usernameOverlay.addEventListener('click', (e)=>{ if(e.target===usernameOverlay){ const hasName=localStorage.getItem('fed_name'); if(hasName){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; } } }); }
if(roomInput){ roomInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); attemptJoinRoom(); } }); }
const drawerRoomInput = document.getElementById('drawer-room-input'); if(drawerRoomInput){ drawerRoomInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); if(roomInput) roomInput.value=drawerRoomInput.value.trim(); attemptJoinRoom(); drawerRoomInput.value=""; } }); }
if(roomPassInput){ roomPassInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); confirmRoomPassword(); } }); }
function renderCommunitiesPopup(){
  const list = document.getElementById('communities-list-popup'); if(!list) return;
  const rooms = getJoinedRooms(); list.innerHTML="";
  if(rooms.length===0){ list.innerHTML=`<div style="text-align:center; padding:20px; color:#888; font-size:13px;">No communities yet.</div>`; return; }
  rooms.forEach(r=>{
    const isCurrent = r===currentRoom;
    const div=document.createElement('div'); div.style.cssText=`display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-radius:12px; cursor:pointer; background:${isCurrent?'#f5f0ff':'white'}; border:1px solid ${isCurrent?'#d1c4e9':'#eee'};`;
    div.innerHTML=`<div style="display:flex; gap:8px; align-items:center;"><span style="background:${isCurrent?'#4a148c':'#eee'}; color:${isCurrent?'white':'#666'}; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:bold;">#</span><div><div style="font-weight:600; font-size:13px;">${r}</div><div style="font-size:11px; color:#888;">${isCurrent?'Current':'Tap'}</div></div></div><span style="font-size:12px; color:#4a148c; font-weight:bold;">${isCurrent?'✓':'→'}</span>`;
    div.onclick=()=>{ if(r==="general"){ joinGeneral(); } else { pendingRoom=r; const hashed=getStoredRoomHash(r); if(!hashed){ pendingMode='join'; if(roomPassTitle) roomPassTitle.textContent='Enter Password'; if(roomPassDesc) roomPassDesc.textContent=`"${r}" is private`; if(roomPassInput) roomPassInput.value=""; if(roomPassError) roomPassError.textContent=""; if(roomPassOverlay) roomPassOverlay.classList.remove('hidden'); if(communitiesPopup) communitiesPopup.style.display='none'; return; } currentRoom=r; localStorage.setItem('last_room',r); saveJoinedRoom(r); loadMessages(); connectToRealtimeStream(); } if(communitiesPopup) communitiesPopup.style.display='none'; };
    list.appendChild(div);
  });
}
if(communitiesBtn){ communitiesBtn.onclick = ()=>{ renderCommunitiesPopup(); if(communitiesPopup){ communitiesPopup.style.display = communitiesPopup.style.display==='block'?'none':'block'; } }; }
const communitiesPopupClose = document.getElementById('communities-popup-close'); if(communitiesPopupClose){ communitiesPopupClose.onclick = ()=>{ if(communitiesPopup) communitiesPopup.style.display='none'; }; }
document.addEventListener('click', (e)=>{ if(communitiesPopup &&!communitiesPopup.contains(e.target) && e.target!==communitiesBtn){ communitiesPopup.style.display='none'; } });
// --- USER PROFILE POPUP (NO SECRET INFO) ---
const userProfilePopup = document.getElementById('user-profile-popup');
const upAvatar = document.getElementById('up-avatar');
const upName = document.getElementById('up-name');
const upGender = document.getElementById('up-gender');
const upClose = document.getElementById('user-profile-close');
const upReplyBtn = document.getElementById('up-reply-btn');
let upCurrentName = null;

async function showUserProfile(senderId, senderName, avatarUrl){
  upCurrentName = senderName;
  if(upAvatar) upAvatar.src = avatarUrl || `https://via.placeholder.com/80/4a148c/fff?text=${encodeURIComponent(senderName.charAt(0))}`;
  if(upName) upName.textContent = senderName;
  if(upGender) upGender.textContent = "Loading...";
  if(userProfilePopup) userProfilePopup.style.display = 'flex';

  try{
    // Only fetch public columns - NOT email
    const {data} = await supabaseClient.from('user_profiles').select('username, avatar_url, gender').eq('id', senderId).maybeSingle();
    if(data){
      if(upName) upName.textContent = data.username || senderName;
      if(upAvatar && data.avatar_url) upAvatar.src = data.avatar_url;
      if(upGender) upGender.textContent = data.gender ? `${data.gender}` : '';
    } else {
      if(upGender) upGender.textContent = '';
    }
  }catch(e){
    if(upGender) upGender.textContent = '';
  }
}

if(upClose){
  upClose.onclick = ()=> { if(userProfilePopup) userProfilePopup.style.display='none'; };
}
if(userProfilePopup){
  userProfilePopup.addEventListener('click', (e)=>{ if(e.target===userProfilePopup) userProfilePopup.style.display='none'; });
}
if(upReplyBtn){
  upReplyBtn.onclick = ()=>{
    if(userProfilePopup) userProfilePopup.style.display='none';
    if(chatInput){
      chatInput.value = `@${upCurrentName} `;
      chatInput.focus();
    }
  };
}

// Make avatars + names clickable
function makeProfileClickable(el, senderId, senderName, avatarUrl){
  if(!el) return;
  el.style.cursor = 'pointer';
  el.addEventListener('click', ()=> showUserProfile(senderId, senderName, avatarUrl));
}