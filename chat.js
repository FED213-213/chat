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
const stickerPanel = document.getElementById('sticker-panel');
const stickerContent = document.getElementById('sticker-content');
const gifSearch = document.getElementById('gif-search');
const stickerBtn = document.getElementById('sticker-btn');
const stickerBackdrop = document.getElementById('sticker-backdrop');
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
let privateRequestsChannel = null;
let pendingFile = null;
let pendingReply = null;
let pendingEditId = null;

if(!localStorage.getItem('fed_is_owner') && currentUser && currentUser.toLowerCase().includes('fed')){
  localStorage.setItem('fed_is_owner','true');
}
function isOwner(){ return localStorage.getItem('fed_is_owner')==='true'; }
function getStoredRoomHash(roomName){ return localStorage.getItem(`room_hash_${roomName}`) || ""; }
function setStoredRoomHash(roomName, hash){ localStorage.setItem(`room_hash_${roomName}`, hash); }
function getJoinedRooms(){ try{ return JSON.parse(localStorage.getItem('joined_rooms')||'[]'); }catch{ return []; } }

async function ensureAuth(){
  let { data:{session} } = await supabaseClient.auth.getSession();
  if(!session){ const {data,error} = await supabaseClient.auth.signInAnonymously(); if(error) throw error; session=data.session; }
  currentUserId=session.user.id; return session.user;
}
ensureAuth().then(()=>{
  if(currentUser){
    usernameOverlay.classList.add('hidden');
    usernameOverlay.style.display='none';
    loadMessages();
    connectToRealtimeStream();
    requestNotificationPermission();
  }
});

function saveJoinedRoom(roomName){ let rooms=getJoinedRooms(); if(!rooms.includes(roomName)){rooms.push(roomName); localStorage.setItem('joined_rooms',JSON.stringify(rooms))} localStorage.setItem('last_room',roomName); }
function formatTime(d){ const date=new Date(d); const diff=Math.floor((new Date()-date)/86400000); let dp=diff===0?"Today":diff===1?"Yesterday":date.toLocaleDateString([],{day:'2-digit',month:'short'}); return `${dp} • ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`; }
async function hashPass(pass){ const enc=new TextEncoder().encode(pass); const buf=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function requestNotificationPermission(){ if('Notification' in window && Notification.permission==='default'){ Notification.requestPermission(); } }
function showSiteNotification(title, body, avatar){ if(document.hidden && 'Notification' in window && Notification.permission==='granted'){ new Notification(title, { body, icon: avatar || '/favicon.ico' }); } }
let chimeAudio = document.getElementById('chime-audio');
if(!chimeAudio){ chimeAudio = new Audio(); chimeAudio.src = "https://cdn.freesound.org/previews/131/131142_2337290-lq.mp3"; chimeAudio.volume = 0.6; }
let audioUnlocked = false;
function unlockAudio(){ if(!audioUnlocked){ chimeAudio.play().then(()=>{ chimeAudio.pause(); chimeAudio.currentTime=0; }).catch(()=>{}); audioUnlocked=true; } }
document.addEventListener('click', unlockAudio, {once:true});
let originalTitle = document.title;
let unreadCount = 0;
function playChime(){ if(!chimeAudio) return; chimeAudio.currentTime = 0; chimeAudio.play().catch(()=>{}); if(navigator.vibrate) navigator.vibrate([100,50,100]); }
function flashTitle(){ if(document.hidden){ unreadCount++; document.title = `(${unreadCount}) New • ${originalTitle}`; } }
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ unreadCount = 0; document.title = originalTitle; } });

async function loadMessages(){
  let hashedPass = getStoredRoomHash(currentRoom);
  if(currentRoom === "general"){ hashedPass = ""; }
  if(!hashedPass && currentRoom!== "general" &&!currentRoom.startsWith('dm_')){
    if(chatMessages) chatMessages.innerHTML = "<div style='padding:30px;text-align:center;color:#888'>🔒 Private room. Enter password.</div>";
    return;
  }
  let rpcRoom = currentRoom; let rpcHash = hashedPass;
  if(currentRoom.startsWith('dm_')){ rpcRoom = currentRoom; rpcHash = ""; }
  const { data, error } = await supabaseClient.rpc('get_messages_secure', { room_name: rpcRoom, pass_hash: rpcHash });
  if(error){ console.error(error); return; }
  if(chatMessages) chatMessages.innerHTML="";
  (data||[]).forEach(m=> appendMessageToFeed(m));
  updateChatHeader();
}

window.sendSticker = async function(sticker){
  await ensureAuth(); unlockAudio();
  const isUrl = sticker.startsWith('http');
  let payload = { text: isUrl? "" : sticker, file_url: isUrl? sticker : null, file_type: isUrl? "image/gif" : null, room_id: currentRoom, sender_name: currentUser, avatar_url: currentAvatar, sender_id: currentUserId };
  if(pendingReply){ payload.reply_to_name = pendingReply.name; payload.reply_to_text = pendingReply.text; }
  const { error } = await supabaseClient.from('messages').insert([payload]);
  if(error && error.message.includes('reply_to')){ delete payload.reply_to_name; delete payload.reply_to_text; delete payload.reply_to_id; await supabaseClient.from('messages').insert([payload]); }
  clearReply();
}
function ensureFilePreviewBox(){
  let box = document.getElementById('file-preview-box'); if(box) return box;
  const bottomBar = document.querySelector('.bottom-bar'); if(!bottomBar) return null;
  bottomBar.insertAdjacentHTML('beforebegin', `<div id="file-preview-box" style="display:none; position:absolute; bottom:100%; left:0; right:0; background:white; border-top:1px solid #ddd; padding:10px; align-items:center; gap:10px; z-index:9996;"><img id="file-preview-img" src="" style="width:60px; height:60px; object-fit:cover; border-radius:8px; display:none;"><div style="flex:1;"><div id="file-preview-name" style="font-weight:bold; font-size:13px;"></div><div id="file-preview-size" style="font-size:11px; color:#888;"></div></div><button id="file-preview-cancel" type="button" style="background:#eee; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer;">×</button></div>`);
  box = document.getElementById('file-preview-box'); document.getElementById('file-preview-cancel').onclick = clearFilePreview; return box;
}
function showFilePreview(file){
  const box = ensureFilePreviewBox(); if(!box) return; pendingFile = file;
  document.getElementById('file-preview-name').textContent = file.name;
  document.getElementById('file-preview-size').textContent = (file.size/1024/1024).toFixed(2) + " MB";
  const img = document.getElementById('file-preview-img');
  if(file.type.startsWith('image/')){ img.style.display='block'; img.src = URL.createObjectURL(file); } else { img.style.display='none'; }
  box.style.display='flex';
}
function clearFilePreview(){ pendingFile = null; if(fileInput) fileInput.value=""; const box = document.getElementById('file-preview-box'); if(box) box.style.display='none'; }
function setReply(id, name, text){ pendingReply = {id, name, text: (text||'File').substring(0,120)}; pendingEditId = null; if(replyToName) replyToName.textContent = "Replying to " + name; if(replyToText) replyToText.textContent = text||'File'; if(replyPreview){ replyPreview.classList.remove('hidden'); replyPreview.style.display = 'flex'; } chatInput?.focus(); }
function setEdit(id, text){ pendingEditId = id; pendingReply = null; if(replyToName) replyToName.textContent = "Editing message"; if(replyToText) replyToText.textContent = text.substring(0,120); if(replyPreview){ replyPreview.classList.remove('hidden'); replyPreview.style.display = 'flex'; } if(chatInput){ chatInput.value = text; chatInput.focus(); } }
function clearReply(){ pendingReply = null; pendingEditId = null; if(replyPreview){ replyPreview.classList.add('hidden'); replyPreview.style.display = 'none'; } if(chatInput && pendingEditId) chatInput.value=""; }
if(replyCancel) replyCancel.onclick = clearReply;

function appendMessageToFeed(m){
  if(!m ||!chatMessages) return;
  const text = m.text; const fileUrl = m.file_url; const fileType = m.file_type; const senderName = m.sender_name; const avatarUrl = m.avatar_url; const isOwn = m.sender_id===currentUserId; const createdAt = m.created_at; const messageId = m.id; const replyToNameVal = m.reply_to_name; const replyToTextVal = m.reply_to_text;
  const row=document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end'; row.style.maxWidth='85%'; row.style.alignSelf=isOwn?'flex-end':'flex-start'; if(isOwn) row.style.marginLeft='auto'; row.dataset.id = messageId||'';
  let avatarEl;
  if(avatarUrl){ avatarEl=document.createElement('img'); avatarEl.src=avatarUrl; avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0; cursor:pointer;'; }
  else { avatarEl=document.createElement('div'); avatarEl.textContent=(senderName||'?').charAt(0).toUpperCase(); avatarEl.style.cssText='width:32px;height:32px;border-radius:50%;background:#4a148c;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0; cursor:pointer;'; }
  avatarEl.onclick = ()=> showUserProfile(m.sender_id, senderName, avatarUrl);
  const bubble=document.createElement('div'); bubble.style.cssText = `background:${isOwn? '#e8dafa':'white'}; color:#1a1a1a; padding:8px 12px; border-radius:12px; box-shadow:0 1px 1px rgba(0,0,0,0.1); position:relative; max-width:100%;`; if(messageId) bubble.setAttribute('data-id',messageId);
  const menuWrap = document.createElement('div'); menuWrap.style.cssText = 'position:absolute; top:2px; right:4px;';
  const arrowBtn = document.createElement('span'); arrowBtn.textContent = '⌄'; arrowBtn.style.cssText = 'cursor:pointer; font-size:16px; color:#888; padding:0 6px; font-weight:bold; user-select:none;';
  const dropdown = document.createElement('div'); dropdown.style.cssText = 'display:none; position:absolute; top:18px; right:0; background:white; border:1px solid #ddd; border-radius:10px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:9999; min-width:130px; overflow:hidden;';
  dropdown.innerHTML = `<div class="dd-item" data-act="reply" style="padding:10px 14px; cursor:pointer; font-size:13px;">↩ Reply</div>${isOwn? `<div class="dd-item" data-act="edit" style="padding:10px 14px; cursor:pointer; font-size:13px;">✏️ Edit</div>` : ''}<div class="dd-item" data-act="delete" style="padding:10px 14px; cursor:pointer; font-size:13px; color:${(isOwn||isOwner()||currentRoom.startsWith('dm_'))?'#c00':'#888'};">🗑️ Delete</div>`;
  arrowBtn.onclick = (e)=>{ e.stopPropagation(); document.querySelectorAll('.msg-dropdown').forEach(d=>{ if(d!==dropdown) d.style.display='none'; }); dropdown.style.display = dropdown.style.display==='none'? 'block' : 'none'; };
  dropdown.onclick = async (e)=>{ const act = e.target.dataset.act; if(!act) return; dropdown.style.display='none'; if(act==='reply') setReply(messageId, senderName, text||'File'); if(act==='edit' && isOwn) setEdit(messageId, text); if(act==='delete'){ const canDelete = isOwn || (isOwner() && currentRoom==='general') || currentRoom.startsWith('dm_'); if(!canDelete) return alert("Only owner can delete others in general"); if(confirm("Delete this message?")) await supabaseClient.from('messages').delete().eq('id',messageId); } };
  dropdown.classList.add('msg-dropdown'); menuWrap.appendChild(arrowBtn); menuWrap.appendChild(dropdown); bubble.appendChild(menuWrap);
  document.addEventListener('click', ()=> dropdown.style.display='none');
  if(replyToNameVal){ const quote=document.createElement('div'); quote.style.cssText='border-left:3px solid #4a148c; background:rgba(0,0,0,0.06); padding:5px 8px; margin-bottom:6px; border-radius:4px; margin-right:16px;'; quote.innerHTML=`<div style="font-size:11px; font-weight:bold; color:#4a148c;">${replyToNameVal}</div><div style="font-size:11px; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${replyToTextVal||''}</div>`; bubble.appendChild(quote); }
  if(!isOwn && senderName){ const b=document.createElement('b'); b.textContent=senderName; b.style.cssText='font-size:12px;color:#075e54;display:block;margin-bottom:2px; cursor:pointer; margin-right:16px;'; b.onclick=()=> showUserProfile(m.sender_id, senderName, avatarUrl); bubble.appendChild(b); }
  if(text){ const s=document.createElement('div'); s.textContent=text; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; s.style.fontSize='14px'; s.style.marginRight='12px'; bubble.appendChild(s); }
  if(fileUrl){ if(fileType?.startsWith('image/') || fileUrl.includes('tenor') || fileUrl.includes('giphy')){ const img=document.createElement('img'); img.src=fileUrl; img.style.cssText='max-width:200px;border-radius:12px;margin-top:5px;cursor:pointer;display:block;'; bubble.appendChild(img); } else if(fileType?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=fileUrl; a.controls=true; a.style.cssText='max-width:220px;margin-top:6px;'; bubble.appendChild(a); } else { const a=document.createElement('a'); a.href=fileUrl; a.target='_blank'; a.textContent='📄 '+(text||'Download'); bubble.appendChild(a); } }
  const meta=document.createElement('div'); meta.style.cssText='display:flex;justify-content:flex-end;gap:10px;margin-top:4px; align-items:center;'; const timeSpan=document.createElement('span'); timeSpan.textContent=formatTime(createdAt||new Date()); timeSpan.style.fontSize='10px'; timeSpan.style.color='#888'; meta.appendChild(timeSpan); bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}

async function sendMessage(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return; }
  await ensureAuth(); unlockAudio();
  let finalText = chatInput?.value.trim() || "";
  if(pendingEditId && finalText){
    const {error} = await supabaseClient.from('messages').update({ text: finalText }).eq('id', pendingEditId).eq('sender_id', currentUserId);
    if(error) alert(error.message); else { if(chatInput) chatInput.value=""; clearReply(); loadMessages(); } return;
  }
  if(pendingFile){
    const file=pendingFile; const caption=finalText||file.name; sendBtn.textContent="..."; sendBtn.disabled=true;
    try{
      const fileName=`${currentRoom}/${currentUserId}_${Date.now()}_${file.name}`;
      const {error}=await supabaseClient.storage.from('chat-files').upload(fileName,file); if(error) throw error;
      const {data}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
      let payload = { text:caption, room_id:currentRoom, file_url:data.publicUrl, file_type:file.type, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId, reply_to_id: pendingReply?.id||null, reply_to_name: pendingReply?.name||null, reply_to_text: pendingReply?.text||null };
      let res = await supabaseClient.from('messages').insert([payload]);
      if(res.error && res.error.message.includes('reply_to')){ delete payload.reply_to_id; delete payload.reply_to_name; delete payload.reply_to_text; await supabaseClient.from('messages').insert([payload]); }
      if(chatInput) chatInput.value=""; clearFilePreview(); clearReply();
    }catch(err){ alert(err.message); }
    sendBtn.textContent="Send"; sendBtn.disabled=false; return;
  }
  if(!finalText) return;
  if(chatInput) chatInput.value="";
  let payload = { text:finalText, room_id:currentRoom, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId, reply_to_id: pendingReply?.id||null, reply_to_name: pendingReply?.name||null, reply_to_text: pendingReply?.text||null };
  let { error } = await supabaseClient.from('messages').insert([payload]);
  if(error && error.message.toLowerCase().includes('reply_to')){ delete payload.reply_to_id; delete payload.reply_to_name; delete payload.reply_to_text; const retry = await supabaseClient.from('messages').insert([payload]); if(retry.error) alert("DB needs reply columns: "+retry.error.message); } else if(error){ alert(error.message); }
  clearReply();
}
async function attemptJoinRoom(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; return alert("Enter your name first"); }
  const name=(roomInput?.value.trim()||"") || (document.getElementById('drawer-room-input')?.value.trim()||""); if(!name) return alert("Enter room name"); pendingRoom=name;
  if(name === "general"){ joinGeneral(); return; }
  if(name.startsWith('dm_')){ currentRoom=name; localStorage.setItem('last_room',name); loadMessages(); connectToRealtimeStream(); return; }
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

// ====== FACEBOOK GROUP INFO STYLE - SINGLE VERSION ======
function updateOnlineUI(users){
  const count = users ? users.length : 0;
  const countEl = document.getElementById('online-number');
  const drawerCountEl = document.getElementById('online-number-drawer');
  const container = document.getElementById('online-users-container');
  const drawerContainer = document.getElementById('online-users-container-drawer');
  const badge = document.getElementById('group-count-badge');
  const popupTitle = document.getElementById('popup-title');

  if(countEl) countEl.textContent = count + (count===1 ? " online" : " online");
  if(drawerCountEl) drawerCountEl.textContent = count;
  if(badge){ badge.textContent = count; badge.style.display = count>0 ? 'block':'none'; }
  if(popupTitle) popupTitle.textContent = `Group info • ${count} member${count!==1?'s':''} in ${currentRoom}`;

  if(count===0){
    const empty = `<div style="padding:24px; text-align:center; color:#888; font-size:13px;">No members online</div>`;
    if(container) container.innerHTML = empty;
    if(drawerContainer) drawerContainer.innerHTML = empty;
    return;
  }

  const html = users.map(u=>{
    const safeName = (u.name||'Guest').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const avatar = u.avatar || u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name||'G')}&background=4a148c&color=fff`;
    const gender = u.gender || u.g || 'member';
    const id = u.id || u.user_id || '';
    return `
      <div onclick="showUserProfile('${id}','${safeName}','${avatar}','${gender}')"
           style="display:flex; align-items:center; gap:12px; padding:12px; border-radius:12px; cursor:pointer; border-bottom:1px solid #f5f5f5;"
           onmouseover="this.style.background='#f5f0ff'" onmouseout="this.style.background='transparent'">
        <img src="${avatar}" style="width:42px; height:42px; border-radius:50%; object-fit:cover; flex-shrink:0;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:14px; color:#222; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.name}</div>
          <div style="font-size:11px; color:#666;">Gender: ${gender} • Joined ${currentRoom}</div>
        </div>
        <div style="color:#4a148c; font-size:18px;">›</div>
      </div>`;
  }).join('');

  if(container) container.innerHTML = html;
  if(drawerContainer) drawerContainer.innerHTML = html;
}

// ====== POPUP LIKE YOUR SCREENSHOT - SINGLE VERSION ======
let upCurrentId = null, upCurrentName = null, upCurrentAvatar = null;

window.showUserProfile = async function(senderId, senderName, avatarUrl, genderFromPresence){
  if(!senderId) return;
  if(senderId === currentUserId){
    // show own profile menu instead
    toggleProfileMenu();
    return;
  }
  upCurrentId = senderId; upCurrentName = senderName; upCurrentAvatar = avatarUrl;
  const popup = document.getElementById('user-profile-popup');
  const av = document.getElementById('up-avatar');
  const nm = document.getElementById('up-name');
  const gn = document.getElementById('up-gender');
  const status = document.getElementById('up-status');
  
  if(av) av.src = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=4a148c&color=fff`;
  if(nm) nm.textContent = senderName;
  if(gn) gn.textContent = genderFromPresence ? `Gender: ${genderFromPresence}` : "Loading...";
  if(status) status.textContent = "● Online in this room";
  if(popup) popup.style.display = 'flex';

  // Try to get real profile from DB
  try{
    const {data} = await supabaseClient.from('user_profiles').select('username, avatar_url, gender').eq('id', senderId).maybeSingle();
    if(data){
      if(nm) nm.textContent = data.username || senderName;
      if(av && data.avatar_url) { av.src = data.avatar_url; upCurrentAvatar = data.avatar_url; }
      if(gn) gn.textContent = data.gender ? `Gender: ${data.gender}` : `Gender: ${genderFromPresence||'member'}`;
    }
  }catch(e){}
}

function messageThisPerson(){
  if(!upCurrentId) return;
  localStorage.setItem('dm_target_id', upCurrentId);
  localStorage.setItem('dm_target_name', upCurrentName);
  localStorage.setItem('dm_target_avatar', upCurrentAvatar || '');
  const ids = [currentUserId, upCurrentId].sort();
  const dmRoomFull = `dm_${ids[0]}_${ids[1]}`.substring(0,60);
  document.getElementById('user-profile-popup').style.display='none';
  const onlinePop = document.getElementById('online-popup');
  if(onlinePop) onlinePop.style.display='none';
  window.location.href = `private.html?to=${upCurrentId}&name=${encodeURIComponent(upCurrentName)}&room=${dmRoomFull}`;
}

window.toggleOnlinePopup = function(){
  const pop = document.getElementById('online-popup');
  if(!pop) return;
  const isHidden = pop.style.display === 'none' || pop.style.display === '';
  
  if(isHidden){
    pop.style.display = 'block';
    document.body.style.overflow = 'hidden'; // prevent background scroll on mobile
    // refresh list
    if(presenceChannel){
      const state = presenceChannel.presenceState();
      const users = [];
      for(const id in state){ state[id].forEach(p=> users.push(p)); }
      updateOnlineUI(users);
    }
  } else {
    pop.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Close when tapping outside on mobile
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('online-popup');
  const groupBtn = document.getElementById('group-members-btn');
  const onlineCount = document.getElementById('online-count');
  if(!pop || pop.style.display !== 'block') return;
  
  const isInsidePopup = pop.contains(e.target);
  const isIcon = groupBtn && (e.target === groupBtn || groupBtn.contains(e.target));
  const isOnlineText = onlineCount && (e.target === onlineCount || onlineCount.contains(e.target));
  
  if(!isInsidePopup && !isIcon && !isOnlineText){
    pop.style.display = 'none';
    document.body.style.overflow = '';
  }
});

function connectToRealtimeStream(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel); if(presenceChannel) supabaseClient.removeChannel(presenceChannel); if(privateRequestsChannel) supabaseClient.removeChannel(privateRequestsChannel);
  realtimeChannel=supabaseClient.channel(`chat-${currentRoom}`)
.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${currentRoom}`},p=>{ appendMessageToFeed(p.new); if(p.new.sender_id!== currentUserId){ playChime(); flashTitle(); showSiteNotification(p.new.sender_name, p.new.text?.substring(0,80)||'New file', p.new.avatar_url); } })
.on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{ loadMessages(); })
.on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`room_id=eq.${currentRoom}`},()=>{ loadMessages(); }).subscribe();
  
  presenceChannel = supabaseClient.channel(`presence-${currentRoom}`, { config: { presence: { key: currentUserId } } });
  presenceChannel.on('presence', { event: 'sync' }, () => { const state = presenceChannel.presenceState(); const users = []; for (const id in state) { state[id].forEach(p => users.push(p)); } updateOnlineUI(users); });
  presenceChannel.subscribe(async (status) => { 
    if (status === 'SUBSCRIBED') { 
      await presenceChannel.track({ 
        id: currentUserId, 
        name: currentUser || 'Guest', 
        avatar: currentAvatar || null, 
        gender: localStorage.getItem('fed_gender') || 'member',
        room: currentRoom 
      }); 
    } 
  });
  
  privateRequestsChannel = supabaseClient.channel('private-requests-'+currentUserId);
  privateRequestsChannel.on('postgres_changes',{ event:'INSERT', schema:'public', table:'private_requests', filter:`to_id=eq.${currentUserId}` },p=>{ showPrivateRequestPopup(p.new); showSiteNotification("Private chat request", `${p.new.from_name} wants to chat privately`, p.new.from_avatar); playChime(); });
  privateRequestsChannel.subscribe();
}

function updateChatHeader(){ 
  const name=localStorage.getItem('fed_name')||currentUser||'Guest'; 
  const room=currentRoom; 
  if(currentRoomLabel) currentRoomLabel.textContent=`Room: ${room} | You: ${name} ${isOwner()?' (Owner)':''}`; 
  if(chatInput) chatInput.placeholder=`Type a message...`; 
}
function joinGeneral(){ currentRoom = "general"; localStorage.setItem('last_room', 'general'); if(document.getElementById('mobile-drawer')) document.getElementById('mobile-drawer').classList.remove('open'); const bd = document.getElementById('drawer-backdrop'); if(bd) bd.classList.remove('open'); loadMessages(); connectToRealtimeStream(); }
if(changeProfileBtn){ changeProfileBtn.onclick = ()=>{ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; if(usernameInput) usernameInput.value = localStorage.getItem('fed_name')||''; const gSel = document.getElementById('p_gender'); if(gSel) gSel.value = localStorage.getItem('fed_gender')||''; const gMail = document.getElementById('p_gmail'); if(gMail) gMail.value = localStorage.getItem('fed_email')||''; if(currentAvatar && avatarPreview) avatarPreview.src = currentAvatar; }; }
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

window.handleGoogle = function(res){
  try{
    const data = JSON.parse(atob(res.credential.split('.')[1]));
    const gmailInput = document.getElementById('p_gmail');
    const userInput = document.getElementById('username-input');
    const avPreview = document.getElementById('avatar-preview');
    if(gmailInput) gmailInput.value = data.email;
    if(userInput && !userInput.value) userInput.value = data.name.split(' ')[0];
    if(avPreview) avPreview.src = data.picture;
    localStorage.setItem('fed_pic', data.picture);
    localStorage.setItem('fed_email', data.email);
  }catch(e){ console.log(e); }
}

if(usernameBtn){
  usernameBtn.addEventListener('click', async ()=>{
    const nameEl = document.getElementById('username-input');
    const genderEl = document.getElementById('p_gender');
    const errorEl = document.getElementById('username-error');
    const gmailEl = document.getElementById('p_gmail');
    
    const name = nameEl.value.trim();
    const gender = genderEl.value;
    const emailValue = gmailEl ? gmailEl.value.trim() : '';
    
    if(errorEl) { errorEl.style.display='none'; errorEl.textContent=''; }
    if(!name) return showErr("Enter a display name");
    if(name.length < 2) return showErr("Name too short");
    if(!gender) return showErr("Select gender");
    
    await ensureAuth();
    usernameBtn.textContent = "Saving...";
    usernameBtn.disabled = true;
    
    function showErr(msg){
      if(errorEl){ errorEl.textContent=msg; errorEl.style.display='block'; }
      else alert(msg);
      usernameBtn.textContent = "Save & Enter Chat →";
      usernameBtn.disabled = false;
    }
    
    try{
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,12) || 'user';
      const handle = base + '_' + Math.random().toString(36).slice(2,6);
      
      let avatarUrl = currentAvatar || localStorage.getItem('fed_pic') || null;
      const file = avatarInput?.files[0];
      if(file){
        const fn = `${currentUserId}_${Date.now()}_${file.name}`;
        const {error} = await supabaseClient.storage.from('avatars').upload(fn,file);
        if(!error){
          const {data} = supabaseClient.storage.from('avatars').getPublicUrl(fn);
          avatarUrl = data.publicUrl;
        }
      }
      
      currentUser=name;
      currentAvatar=avatarUrl;
      localStorage.setItem('fed_name',name);
      localStorage.setItem('fed_gender',gender);
      localStorage.setItem('fed_handle',handle);
      if(emailValue) localStorage.setItem('fed_email', emailValue);
      if(avatarUrl) localStorage.setItem('chat_avatar',avatarUrl);

      // ONLY columns that exist in your table
      const { error } = await supabaseClient.from('user_profiles').upsert([{
        id: currentUserId,
        username: name,
        handle: handle,
        avatar_url: avatarUrl,
        gender: gender
      }],{onConflict:'id'});

      if(error) throw error;
      
      usernameOverlay.classList.add('hidden');
      usernameOverlay.style.display='none';
      document.body.style.overflow = '';
      updateChatHeader();
      loadMessages();
      connectToRealtimeStream();
      
    }catch(e){
      console.error(e);
      showErr(e.message);
    }
    usernameBtn.textContent = "Save & Enter Chat →";
    usernameBtn.disabled = false;
  });
}
if(roomPassOverlay){ roomPassOverlay.addEventListener('click', (e)=>{ if(e.target===roomPassOverlay) roomPassOverlay.classList.add('hidden'); }); }
if(roomPassClose) roomPassClose.addEventListener('click',()=> roomPassOverlay.classList.add('hidden'));
if(usernameOverlay){ usernameOverlay.addEventListener('click', (e)=>{ if(e.target===usernameOverlay){ const hasName=localStorage.getItem('fed_name'); if(hasName){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; } } }); }
if(roomInput){ roomInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); attemptJoinRoom(); } }); }
const drawerRoomInput = document.getElementById('drawer-room-input'); if(drawerRoomInput){ drawerRoomInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); if(roomInput) roomInput.value=drawerRoomInput.value.trim(); attemptJoinRoom(); drawerRoomInput.value=""; } }); }
if(roomPassInput){ roomPassInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); confirmRoomPassword(); } }); }
function renderCommunitiesPopup(){
  const list = document.getElementById('communities-list-popup'); if(!list) return; const rooms = getJoinedRooms(); list.innerHTML="";
  if(rooms.length===0){ list.innerHTML=`<div style="text-align:center; padding:20px; color:#888; font-size:13px;">No communities yet.</div>`; return; }
  rooms.forEach(r=>{
    const isCurrent = r===currentRoom; const div=document.createElement('div'); div.style.cssText=`display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-radius:12px; cursor:pointer; background:${isCurrent?'#f5f0ff':'white'}; border:1px solid ${isCurrent?'#d1c4e9':'#eee'};`;
    div.innerHTML=`<div style="display:flex; gap:8px; align-items:center;"><span style="background:${isCurrent?'#4a148c':'#eee'}; color:${isCurrent?'white':'#666'}; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:bold;">#</span><div><div style="font-weight:600; font-size:13px;">${r}</div><div style="font-size:11px; color:#888;">${isCurrent?'Current':'Tap'}</div></div></div><span style="font-size:12px; color:#4a148c; font-weight:bold;">${isCurrent?'✓':'→'}</span>`;
    div.onclick=()=>{ if(r==="general"){ joinGeneral(); } else { pendingRoom=r; const hashed=getStoredRoomHash(r); if(!hashed &&!r.startsWith('dm_')){ pendingMode='join'; if(roomPassTitle) roomPassTitle.textContent='Enter Password'; if(roomPassDesc) roomPassDesc.textContent=`"${r}" is private`; if(roomPassInput) roomPassInput.value=""; if(roomPassError) roomPassError.textContent=""; if(roomPassOverlay) roomPassOverlay.classList.remove('hidden'); if(communitiesPopup) communitiesPopup.style.display='none'; return; } currentRoom=r; localStorage.setItem('last_room',r); saveJoinedRoom(r); loadMessages(); connectToRealtimeStream(); } if(communitiesPopup) communitiesPopup.style.display='none'; }; list.appendChild(div);
  });
}
if(communitiesBtn){ communitiesBtn.onclick = (e)=>{ e.stopPropagation(); renderCommunitiesPopup(); if(communitiesPopup){ communitiesPopup.style.display = communitiesPopup.style.display==='block'?'none':'block'; } }; }
const communitiesPopupClose = document.getElementById('communities-popup-close'); if(communitiesPopupClose){ communitiesPopupClose.onclick = ()=>{ if(communitiesPopup) communitiesPopup.style.display='none'; }; }
document.addEventListener('click', (e)=>{ 
  if(communitiesPopup &&!communitiesPopup.contains(e.target) && e.target!==communitiesBtn){ communitiesPopup.style.display='none'; } 
  // close online popup when clicking outside
  const pop = document.getElementById('online-popup');
  const groupBtn = document.getElementById('group-members-btn');
  const onlineBtn = document.getElementById('online-count');
  if(pop && pop.style.display==='block' && !pop.contains(e.target) && e.target!==groupBtn && !groupBtn?.contains(e.target) && e.target!==onlineBtn && !onlineBtn?.contains(e.target)){
    // keep open if clicking inside
  }
});

function showPrivateRequestPopup(req){
  const existing = document.getElementById('private-request-incoming'); if(existing) existing.remove();
  const div = document.createElement('div'); div.id='private-request-incoming'; div.style.cssText='position:fixed; top:20px; right:20px; background:white; border-radius:16px; padding:16px; box-shadow:0 8px 24px rgba(0,0,0,0.2); z-index:999999; width:300px;';
  div.innerHTML=`<div style="display:flex; gap:10px; align-items:center;"><img src="${req.from_avatar||''}" style="width:40px; height:40px; border-radius:50%; background:#eee;"><div><b>${req.from_name}</b><div style="font-size:12px; color:#666;">Wants private chat</div></div></div><div style="display:flex; gap:8px; margin-top:12px;"><button id="pr-accept" style="flex:1; background:#4a148c; color:white; border:none; padding:8px; border-radius:8px; cursor:pointer;">Accept</button><button id="pr-decline" style="flex:1; background:#eee; border:none; padding:8px; border-radius:8px; cursor:pointer;">Decline</button></div>`;
  document.body.appendChild(div);
  document.getElementById('pr-accept').onclick = async ()=>{ await supabaseClient.from('private_requests').update({ status:'accepted' }).eq('id', req.id); div.remove(); const ids=[req.from_id, req.to_id].sort(); const dmRoomFull = `dm_${ids[0]}_${ids[1]}`.substring(0,60); currentRoom=dmRoomFull; localStorage.setItem('last_room',currentRoom); saveJoinedRoom(currentRoom); loadMessages(); connectToRealtimeStream(); };
  document.getElementById('pr-decline').onclick = async ()=>{ await supabaseClient.from('private_requests').update({ status:'declined' }).eq('id', req.id); div.remove(); };
}
document.getElementById('user-profile-close')?.addEventListener('click', ()=> document.getElementById('user-profile-popup').style.display='none');
document.getElementById('user-profile-popup')?.addEventListener('click', (e)=>{ if(e.target.id==='user-profile-popup') e.currentTarget.style.display='none'; });
document.getElementById('up-message-btn')?.addEventListener('click', messageThisPerson);

let mediaRecorder = null, audioChunks = [], isRecording = false, recordingStartTime = null, recordingTimer = null;
const micBtn = document.getElementById('mic-btn');
function formatRecordingTime(ms){ const s = Math.floor(ms/1000); const m = Math.floor(s/60); const sec = s%60; return `${m}:${sec.toString().padStart(2,'0')}`; }
async function startRecording(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true }); mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }); audioChunks = []; recordingStartTime = Date.now();
    mediaRecorder.ondataavailable = e => { if(e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async ()=>{ clearInterval(recordingTimer); stream.getTracks().forEach(t=>t.stop()); if(audioChunks.length===0) return; const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); if(audioBlob.size < 1000){ alert("Too short"); resetMic(); return; } micBtn.textContent = "⏳"; micBtn.disabled = true; try{ await ensureAuth(); const fileName = `${currentRoom}/${currentUserId}_${Date.now()}_voice.webm`; const {error}=await supabaseClient.storage.from('chat-files').upload(fileName, audioBlob, { contentType: 'audio/webm' }); if(error) throw error; const {data}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName); let payload = { text: `🎤 Voice (${formatRecordingTime(Date.now()-recordingStartTime)})`, file_url: data.publicUrl, file_type: 'audio/webm', room_id: currentRoom, sender_name: currentUser, avatar_url: currentAvatar, sender_id: currentUserId, reply_to_id: pendingReply?.id||null, reply_to_name: pendingReply?.name||null, reply_to_text: pendingReply?.text||null }; await supabaseClient.from('messages').insert([payload]); clearReply(); }catch(err){ alert("Voice failed: "+err.message); } resetMic(); };
    mediaRecorder.start(); isRecording = true; micBtn.textContent = "🔴"; micBtn.style.background = "#ff1744"; micBtn.style.color = "white"; recordingTimer = setInterval(()=>{ if(chatInput) chatInput.placeholder = `🔴 Recording ${formatRecordingTime(Date.now()-recordingStartTime)}... tap mic to stop`; }, 500);
  }catch(err){ alert("Mic permission denied."); resetMic(); }
}
function stopRecording(){ if(mediaRecorder && mediaRecorder.state==='recording'){ mediaRecorder.stop(); } }
function resetMic(){ isRecording = false; if(micBtn){ micBtn.textContent = "🎤"; micBtn.style.background = ""; micBtn.style.color = ""; micBtn.disabled = false; } if(chatInput) { chatInput.placeholder = `Type a message...`; } clearInterval(recordingTimer); }
if(micBtn){ micBtn.onclick = ()=>{ unlockAudio(); if(!isRecording){ startRecording(); } else { stopRecording(); } }; micBtn.addEventListener('contextmenu', e=> e.preventDefault()); }
function toggleProfileMenu(){
  const menu=document.getElementById('profile-menu'); if(!menu) return; const isHidden=menu.style.display==='none' || menu.style.display==='';
  if(isHidden){
    const av=document.getElementById('pm-avatar'); const navPic=document.getElementById('nav-profile-pic');
    const name=document.getElementById('pm-name'); const email=document.getElementById('pm-email'); const gender=document.getElementById('pm-gender');
    const myAvatar=localStorage.getItem('chat_avatar') || localStorage.getItem('fed_pic') || ''; const myName=localStorage.getItem('fed_name') || 'Guest'; const myEmail=localStorage.getItem('fed_email') || ''; const myGender=localStorage.getItem('fed_gender') || '';
    if(av) av.src=myAvatar || `https://via.placeholder.com/56/4a148c/fff?text=${encodeURIComponent(myName.charAt(0))}`; if(navPic) navPic.src=myAvatar || `https://via.placeholder.com/36/4a148c/fff?text=${encodeURIComponent(myName.charAt(0))}`; if(name) name.textContent=myName; if(email) email.textContent=myEmail; if(gender) gender.textContent=myGender||'Member';
    loadRecentPrivateChats(); menu.style.display='block';
  } else { menu.style.display='none'; }
}
async function loadRecentPrivateChats(){
  const list=document.getElementById('recent-chats-list'); if(!list) return; await ensureAuth();
  const {data, error} = await supabaseClient.from('private_requests').select('*').or(`from_id.eq.${currentUserId},to_id.eq.${currentUserId}`).eq('status','accepted').order('updated_at',{ascending:false}).limit(10);
  if(error ||!data || data.length===0){ list.innerHTML=`<div style="text-align:center;padding:20px;color:#999;font-size:13px">No private chats yet.<br>Tap someone's pic in chat to start.</div>`; return; }
  list.innerHTML=data.map(req=>{
    const isFromMe=req.from_id===currentUserId; const otherName=isFromMe? req.to_name : req.from_name; const otherId=isFromMe? req.to_id : req.from_id; const otherAvatar=isFromMe? '' : req.from_avatar; const ids=[currentUserId, otherId].sort(); const dmRoom=`dm_${ids[0]}_${ids[1]}`.substring(0,60);
    return `<div onclick="openDM('${otherId}','${otherName.replace(/'/g,"\\'")}','${dmRoom}')" style="display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:12px;cursor:pointer;background:#fafafa;margin-bottom:6px;"><img src="${otherAvatar||`https://via.placeholder.com/36/4a148c/fff?text=${encodeURIComponent(otherName.charAt(0))}`}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;"><div style="flex:1"><div style="font-size:13px;font-weight:600">${otherName}</div><div style="font-size:11px;color:#00c853">● Tap to chat</div></div><span style="color:#4a148c">→</span></div>`;
  }).join('');
}
window.openDM = function(id, name, room){ localStorage.setItem('dm_target_id', id); localStorage.setItem('dm_target_name', name); window.location.href=`private.html?to=${id}&name=${encodeURIComponent(name)}&room=${room}`; }
document.addEventListener('click', (e)=>{ const menu=document.getElementById('profile-menu'); const pic=document.getElementById('nav-profile-pic'); if(menu && menu.style.display==='block' &&!menu.contains(e.target) && e.target!==pic){ menu.style.display='none'; } });
window.addEventListener('load', ()=>{ const navPic=document.getElementById('nav-profile-pic'); if(navPic){ const myAvatar=localStorage.getItem('chat_avatar') || localStorage.getItem('fed_pic'); const myName=localStorage.getItem('fed_name')||'G'; navPic.src=myAvatar || `https://via.placeholder.com/36/4a148c/fff?text=${encodeURIComponent(myName.charAt(0))}`; } });

let notifLastSeen = localStorage.getItem('notif_last_seen') || new Date(Date.now() - 86400000).toISOString();
window.toggleNotifDrawer = function(){
  const drawer = document.getElementById('notif-drawer');
  const backdrop = document.getElementById('notif-backdrop');
  if(!drawer || !backdrop) return;
  const isOpen = drawer.classList.contains('open');
  if(isOpen){
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(()=>{ drawer.style.display='none'; backdrop.style.display='none'; }, 200);
  } else {
    drawer.style.display='flex';
    backdrop.style.display='block';
    setTimeout(()=>{ drawer.classList.add('open'); backdrop.classList.add('open'); }, 10);
    loadNotifications();
  }
}
window.handleNotifClick = function(type, id){
  const drawer = document.getElementById('notif-drawer');
  const backdrop = document.getElementById('notif-backdrop');
  if(drawer) drawer.classList.remove('open');
  if(backdrop) backdrop.classList.remove('open');
  setTimeout(()=>{ if(drawer) drawer.style.display='none'; if(backdrop) backdrop.style.display='none'; }, 200);
  if(type==='room'){
    currentRoom = id;
    localStorage.setItem('last_room', id);
    loadMessages();
    connectToRealtimeStream();
    setTimeout(()=>{ if(chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; }, 500);
  }
}
async function loadNotifications(){
  const list = document.getElementById('notif-list');
  if(!list) return;
  await ensureAuth();
  list.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Loading...</div>';
  let items = [];
  try{
    const { data: requests } = await supabaseClient.from('private_requests').select('*').or(`to_id.eq.${currentUserId},from_id.eq.${currentUserId}`).order('created_at', {ascending:false}).limit(10);
    (requests||[]).forEach(r=>{
      const isToMe = r.to_id === currentUserId;
      const otherId = isToMe ? r.from_id : r.to_id;
      const otherName = isToMe ? r.from_name : r.to_name;
      const ids = [currentUserId, otherId].sort();
      const dmRoom = `dm_${ids[0]}_${ids[1]}`.substring(0,60);
      const unread = new Date(r.created_at) > new Date(notifLastSeen) && isToMe && r.status==='pending';
      const safeName = otherName.replace(/'/g,"");
      items.push({ time: r.created_at, unread, html: `<div class="notif-item ${unread?'unread':''}" onclick="openDM('${otherId}','${safeName}','${dmRoom}')" style="cursor:pointer"><img src="${r.from_avatar||''}" style="width:40px; height:40px; border-radius:50%; background:#eee;"><div style="flex:1"><div style="font-size:13px;"><b>${isToMe?r.from_name:r.to_name}</b> sent private request</div><div style="font-size:11px; color:#888;">${formatTime(r.created_at)}</div></div></div>` });
    });
  }catch(e){}
  try{
    const joinedRooms = getJoinedRooms();
    if(joinedRooms.length>0){
      const { data: missedMsgs } = await supabaseClient.from('messages').select('*').in('room_id', joinedRooms).gt('created_at', notifLastSeen).neq('sender_id', currentUserId).order('created_at', {ascending:false}).limit(15);
      (missedMsgs||[]).forEach(m=>{
        items.push({ time: m.created_at, unread: true, html: `<div class="notif-item unread" onclick="handleNotifClick('room','${m.room_id}')" style="cursor:pointer"><img src="${m.avatar_url||''}" style="width:40px; height:40px; border-radius:50%;"><div style="flex:1"><div style="font-size:13px;"><b>${m.sender_name}</b> in #${m.room_id}</div><div style="font-size:12px; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${(m.text||'📎 File').replace(/</g,'&lt;')}</div><div style="font-size:11px; color:#888;">${formatTime(m.created_at)}</div></div></div>` });
      });
    }
  }catch(e){}
  items.sort((a,b)=> new Date(b.time) - new Date(a.time));
  const unreadCount2 = items.filter(i=>i.unread).length;
  const badge = document.getElementById('notif-badge');
  if(badge){ if(unreadCount2>0){ badge.textContent = unreadCount2>9?'9+':unreadCount2; badge.style.display='block'; } else { badge.style.display='none'; } }
  if(items.length===0){ list.innerHTML = `<div style="text-align:center; padding:40px 20px; color:#999;"><div style="font-size:40px;">🔔</div><div>No notifications</div></div>`; } else { list.innerHTML = items.map(i=>i.html).join(''); }
}
document.getElementById('notif-bell')?.addEventListener('click', toggleNotifDrawer);
document.getElementById('notif-close')?.addEventListener('click', toggleNotifDrawer);
document.getElementById('notif-backdrop')?.addEventListener('click', toggleNotifDrawer);
document.getElementById('notif-mark-read')?.addEventListener('click', ()=>{
  notifLastSeen = new Date().toISOString();
  localStorage.setItem('notif_last_seen', notifLastSeen);
  const b=document.getElementById('notif-badge'); if(b) b.style.display='none';
  loadNotifications();
});
setInterval(async ()=>{ if(document.hidden) await loadNotifications(); }, 30000);
window.addEventListener('load', ()=> setTimeout(loadNotifications, 2000));

// EMOJIS
const EMOJIS_CATEGORIES = {
  "😀": [..."😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳🥲🥹☺️😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🫡🤠😴🤫🫣"],
  "👋 Hands": [..."👍👎👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆👇☝️🫵👋🤚🖐️✋🖖🫱🫲🫳🫴👏🙌🫶👐🤲🤝🙏💪🦾🦿"],
  "❤️ Love": [..."❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💝💘❤️‍🔥❤️‍🩹💟💌💋🫶💯💥💫💦💨💬💭💤"],
};
let currentEmojiCat = "😀";
function loadEmojis(){
  if(!stickerContent) return;
  stickerContent.innerHTML = "";
  stickerContent.style.display = "block";
  stickerContent.style.gridTemplateColumns = "unset";
  const tabs = document.createElement('div');
  tabs.style.cssText = "display:flex; gap:6px; overflow-x:auto; padding:8px; position:sticky; top:0; background:white; z-index:2; border-bottom:1px solid #eee;";
  Object.keys(EMOJIS_CATEGORIES).forEach(cat=>{
    const b = document.createElement('button');
    b.textContent = cat;
    b.style.cssText = `padding:6px 12px; border-radius:20px; border:none; cursor:pointer; font-size:14px; background:${currentEmojiCat===cat?'#4a148c':'#eee'}; color:${currentEmojiCat===cat?'white':'#333'};`;
    b.onclick = ()=>{ currentEmojiCat = cat; loadEmojis(); };
    tabs.appendChild(b);
  });
  stickerContent.appendChild(tabs);
  const grid = document.createElement('div');
  grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fill,minmax(42px,1fr)); gap:2px; padding:10px;";
  (EMOJIS_CATEGORIES[currentEmojiCat]||[]).forEach(e=>{
    const d=document.createElement('div'); 
    d.textContent=e;
    d.style.cssText="font-size:26px; text-align:center; padding:6px; cursor:pointer; border-radius:8px;";
    d.onclick=()=>{ if(chatInput){ chatInput.value+=e; chatInput.focus(); } };
    grid.appendChild(d);
  });
  stickerContent.appendChild(grid);
}
const GIPHY_KEY = "sSJIYtOFnu0UeRfEPaQ8fn1DAJjcqr5k";
async function loadGifs(query=""){
  if(!stickerContent) return;
  stickerContent.innerHTML="<div style='grid-column:1/-1;text-align:center;padding:20px;color:#888'>Loading...</div>";
  stickerContent.style.gridTemplateColumns="repeat(auto-fill,minmax(90px,1fr))";
  try{
    let url = !query ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=50&rating=g` : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=50&rating=g`;
    const res = await fetch(url);
    const json = await res.json();
    if(!json.data || json.data.length===0){ stickerContent.innerHTML="<div style='grid-column:1/-1;text-align:center;padding:20px'>No GIFs found</div>"; return; }
    stickerContent.innerHTML="";
    json.data.forEach(item=>{
      const gifUrl = item.images.fixed_height_small.url || item.images.fixed_height.url;
      const img=document.createElement('img');
      img.src=gifUrl;
      img.loading="lazy";
      img.style.cssText="width:100%;height:90px;object-fit:cover;border-radius:10px;cursor:pointer;background:#f5f5f5";
      img.onclick=()=>{ sendSticker(gifUrl); closeStickerPanel(); };
      stickerContent.appendChild(img);
    });
  }catch(err){ stickerContent.innerHTML="<div style='grid-column:1/-1;text-align:center;padding:20px;color:red'>Giphy blocked</div>"; }
}
function loadStickers(){ loadGifs("bear love cute"); }
document.querySelectorAll('.stk-tab')?.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.stk-tab').forEach(b=>{ b.style.background='#eee'; b.style.color='black'; });
    btn.style.background='#4a148c'; btn.style.color='white';
    let currentStkTab = btn.dataset.tab;
    if(currentStkTab==='emoji'){ if(gifSearch) gifSearch.style.display='none'; loadEmojis(); }
    if(currentStkTab==='gif'){ if(gifSearch){ gifSearch.style.display='block'; gifSearch.focus(); } loadGifs(); }
    if(currentStkTab==='sticker'){ if(gifSearch) gifSearch.style.display='block'; loadStickers(); }
  });
});
let gifTimeout;
gifSearch?.addEventListener('input', ()=>{ clearTimeout(gifTimeout); gifTimeout = setTimeout(()=> loadGifs(gifSearch.value), 400); });
window.closeStickerPanel = function(){ stickerPanel.style.display='none'; stickerBackdrop.style.display='none'; }
stickerBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); stickerPanel.style.display='flex'; stickerBackdrop.style.display='block'; gifSearch.style.display='none'; loadEmojis(); });
stickerBackdrop?.addEventListener('click', closeStickerPanel);