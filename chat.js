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

const BROWSER_ID_KEY = 'chat_browser_lock';
let browserLock = localStorage.getItem(BROWSER_ID_KEY);
if (!browserLock) {
  browserLock = crypto.randomUUID();
  localStorage.setItem(BROWSER_ID_KEY, browserLock);
}

let currentRoom = localStorage.getItem('last_room') || "general";
let currentUser = localStorage.getItem('chat_username') || localStorage.getItem('fed_name') || null;
let currentAvatar = localStorage.getItem('chat_avatar') || null;
let currentUserId = null;
let pendingRoom = null, pendingMode = null, realtimeChannel = null;
let pendingFile = null;
let pendingReply = null;
let unreadCount = 0;
let notifAudioCtx = null;
let onlineHeartbeat = null;

async function ensureAuth() {
  let { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  currentUserId = session.user.id;
  return session.user;
}
ensureAuth().then(() => {
  if(currentUser) {
    if(usernameOverlay){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; }
    loadMessages();
    connectToRealtimeStream();
  }
});

function getJoinedRooms() {
  try { return JSON.parse(localStorage.getItem('joined_rooms') || '[]'); } catch { return []; }
}
function saveJoinedRoom(roomName) {
  let rooms = getJoinedRooms();
  if(!rooms.includes(roomName)) {
    rooms.push(roomName);
    localStorage.setItem('joined_rooms', JSON.stringify(rooms));
  }
  localStorage.setItem('last_room', roomName);
  localStorage.setItem('current_room', roomName);
}
saveJoinedRoom(currentRoom);

function createFilePreviewBox() {
  if(document.getElementById('file-preview-box')) return;
  const bottomBar = document.querySelector('.bottom-bar');
  if(!bottomBar) return;
  const previewHTML = `
  <div id="file-preview-box" class="hidden" style="background:white; border-top:1px solid #ddd; padding:10px; align-items:center; gap:10px; display:none;">
    <img id="file-preview-img" src="" style="width:60px; height:60px; object-fit:cover; border-radius:8px; display:none;">
    <div id="file-preview-info" style="flex:1; overflow:hidden;">
      <p id="file-preview-name" style="font-size:13px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></p>
      <p id="file-preview-size" style="font-size:11px; color:#888;"></p>
    </div>
    <button id="file-preview-cancel" style="background:#eee; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:18px;">×</button>
  </div>`;
  bottomBar.insertAdjacentHTML('beforebegin', previewHTML);
  const cb = document.getElementById('file-preview-cancel');
  if(cb) cb.onclick = clearFilePreview;
}
createFilePreviewBox();
function showFilePreview(file) {
  pendingFile = file;
  const box = document.getElementById('file-preview-box');
  const img = document.getElementById('file-preview-img');
  const name = document.getElementById('file-preview-name');
  const size = document.getElementById('file-preview-size');
  if(!box ||!name ||!size) return;
  name.textContent = file.name;
  size.textContent = (file.size/1024/1024).toFixed(2) + " MB • " + file.type;
  if(file.type.startsWith('image/') && img){ img.style.display='block'; img.src=URL.createObjectURL(file); }
  else if(img) img.style.display='none';
  box.classList.remove('hidden'); box.style.display='flex';
  if(chatInput) chatInput.focus();
}
function clearFilePreview() {
  pendingFile = null;
  if(fileInput) fileInput.value="";
  const box=document.getElementById('file-preview-box');
  if(box){ box.classList.add('hidden'); box.style.display='none'; }
  const img=document.getElementById('file-preview-img');
  if(img) img.src="";
}

function createProfileOverlays() {
  if(document.getElementById('profile-overlay')) return;
  const html=`
  <div id="profile-overlay" class="password-overlay hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:10000;">
    <div class="password-box" style="padding:0; overflow:hidden; max-width:340px; background:white; border-radius:16px;">
      <div style="background:#4a148c; padding:15px; color:white; display:flex; align-items:center; gap:10px;">
        <span id="profile-close" style="cursor:pointer; font-size:20px;">←</span><b>Profile</b>
      </div>
      <div style="text-align:center; padding:20px;">
        <img id="profile-full-img" src="" style="width:140px; height:140px; border-radius:50%; object-fit:cover; cursor:pointer; border:3px solid #eee;">
        <h3 id="profile-name" style="margin:12px 0 4px;">Name</h3>
        <div style="background:#f5f5f5; padding:10px; border-radius:8px; margin-top:15px; text-align:left;">
          <p style="font-size:12px; color:#888;">Room</p><p id="profile-room" style="font-weight:bold;">general</p>
          <p style="font-size:12px; color:#888; margin-top:8px;">Username</p><p id="profile-username-detail">-</p>
        </div>
        <button id="profile-view-full" style="margin-top:15px; background:#4a148c; color:white; border:none; padding:10px; border-radius:8px; width:100%; cursor:pointer;">View Full Picture</button>
      </div>
    </div>
  </div>
  <div id="full-pic-overlay" class="password-overlay hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); display:flex; align-items:center; justify-content:center; z-index:10001;">
    <span id="full-pic-close" style="position:absolute; top:20px; right:20px; color:white; font-size:30px; cursor:pointer;">×</span>
    <img id="full-pic-img" src="" style="max-width:90%; max-height:90%; border-radius:8px; object-fit:contain;">
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const pc=document.getElementById('profile-close'); if(pc) pc.onclick=()=>document.getElementById('profile-overlay').classList.add('hidden');
  const po=document.getElementById('profile-overlay'); if(po) po.onclick=(e)=>{ if(e.target.id==='profile-overlay') e.currentTarget.classList.add('hidden'); };
  const fp=document.getElementById('full-pic-overlay'); if(fp) fp.onclick=()=>fp.classList.add('hidden');
  const fpc=document.getElementById('full-pic-close'); if(fpc) fpc.onclick=()=>fp.classList.add('hidden');
  const pvf=document.getElementById('profile-view-full'); if(pvf) pvf.onclick=()=>openFullImage(document.getElementById('profile-full-img').src);
  const pfi=document.getElementById('profile-full-img'); if(pfi) pfi.onclick=()=>openFullImage(pfi.src);
}
createProfileOverlays();
function openProfileView(senderName, avatarUrl){
  const pn=document.getElementById('profile-name'); if(pn) pn.textContent=senderName;
  const pud=document.getElementById('profile-username-detail'); if(pud) pud.textContent=senderName;
  const pr=document.getElementById('profile-room'); if(pr) pr.textContent=currentRoom;
  const pfi=document.getElementById('profile-full-img'); if(pfi) pfi.src=avatarUrl||`https://via.placeholder.com/300/4a148c/ffffff?text=${senderName.charAt(0).toUpperCase()}`;
  const po=document.getElementById('profile-overlay'); if(po) po.classList.remove('hidden');
}
function openFullImage(url){
  if(!url) return;
  const fi=document.getElementById('full-pic-img'); if(fi) fi.src=url;
  const fo=document.getElementById('full-pic-overlay'); if(fo) fo.classList.remove('hidden');
}
if(currentAvatar && avatarPreview) avatarPreview.src=currentAvatar;
function formatTime(d){
  const date=new Date(d);
  const diff=Math.floor((new Date()-date)/86400000);
  let dp=diff===0?"Today":diff===1?"Yesterday":date.toLocaleDateString([],{day:'2-digit',month:'short'});
  return `${dp} • ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}
async function hashPass(pass){
  const enc = new TextEncoder().encode(pass);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ===== ONLINE PRESENCE - VISIBLE IN SUPABASE + REALTIME =====
let presenceChannel;
let onlineUsersMap = {};

async function upsertOnlinePresence(){
  try{
    if(!currentUserId) return;
    const userName = localStorage.getItem('fed_name') || localStorage.getItem('chat_username') || currentUser || 'Guest';
    const userAvatar = localStorage.getItem('chat_avatar') || currentAvatar || '';
    await supabaseClient.from('online_presence').upsert({
      id: currentUserId,
      username: userName,
      avatar_url: userAvatar,
      room_id: currentRoom,
      is_online: true,
      last_seen: new Date().toISOString()
    }, { onConflict: 'id' });
  }catch(e){ console.log("upsert online_presence failed - did you create table?", e.message); }
}
async function markOffline(){
  try{
    if(!currentUserId) return;
    await supabaseClient.from('online_presence').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', currentUserId);
  }catch(e){}
}

async function setupPresence(){
  try {
    const userId = currentUserId;
    if(!userId) return;
    const userName = localStorage.getItem('fed_name') || localStorage.getItem('chat_username') || currentUser || 'Guest';
    const userAvatar = localStorage.getItem('chat_avatar') || currentAvatar || '';

    await supabaseClient.from('user_profiles').upsert({ id: userId, username: userName, avatar_url: userAvatar }, {onConflict:'id'});

    if(presenceChannel) supabaseClient.removeChannel(presenceChannel);
    presenceChannel = supabaseClient.channel(`online-${currentRoom}`, { config: { presence: { key: userId } } });

    presenceChannel.on('presence', {event:'sync'}, () => {
      const state = presenceChannel.presenceState();
      updateOnlineList(state);
    }).subscribe(async (status)=>{
      if(status === 'SUBSCRIBED'){
        await presenceChannel.track({ user_id: userId, username: userName, avatar: userAvatar, room: currentRoom, online_at: new Date().toISOString() });
        await upsertOnlinePresence();
        // heartbeat every 20s so dashboard last_seen stays fresh
        if(onlineHeartbeat) clearInterval(onlineHeartbeat);
        onlineHeartbeat = setInterval(upsertOnlinePresence, 20000);
      }
    });
  } catch(e) { console.log("presence skipped", e.message); }
}

function updateOnlineList(state){
  const users = [];
  for(const userId in state){
    const presences = state[userId];
    if(presences && presences[0]) users.push(presences[0]);
  }
  const count = users.length;
  const onlineNumber = document.getElementById('online-number');
  if(onlineNumber) onlineNumber.textContent = `${count} online`;
  const onlineNumberDrawer = document.getElementById('online-number-drawer');
  if(onlineNumberDrawer) onlineNumberDrawer.textContent = `${count}`;

  const containers = [document.getElementById('online-users-container'), document.getElementById('online-users-container-drawer')];
  containers.forEach(container => {
    if(!container) return;
    container.innerHTML = '';
    if(count === 0){
      container.innerHTML = `<div style="font-size:12px; opacity:0.6; padding:10px; text-align:center;">No one else online</div>`;
    } else {
      users.forEach(u => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:13px; background:rgba(0,0,0,0.05); padding:8px 10px; border-radius:10px;';
        if(container.id.includes('drawer')) div.style.background = 'rgba(255,255,255,0.1)';
        const avatar = u.avatar? `<img src="${u.avatar}" style="width:26px; height:26px; border-radius:50%; object-fit:cover;">` : `<div style="width:26px; height:26px; border-radius:50%; background:#4a148c; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:11px;">${(u.username||'?').charAt(0).toUpperCase()}</div>`;
        div.innerHTML = `${avatar} <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.username}</span> <span style="width:8px; height:8px; background:#00e676; border-radius:50%; flex-shrink:0;"></span>`;
        container.appendChild(div);
      });
    }
  });
}

// Mark offline when closing tab
window.addEventListener('beforeunload', ()=>{ markOffline(); });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') upsertOnlinePresence(); });

if(avatarInput){
  avatarInput.addEventListener('change', ()=>{
    const f=avatarInput.files[0]; if(!f||!avatarPreview) return;
    avatarPreview.src=URL.createObjectURL(f);
  });
}
function handleGoogle(res){
  try{
    const data = JSON.parse(atob(res.credential.split('.')[1]));
    if(usernameInput) usernameInput.value = data.name;
    const gmailInput = document.getElementById('p_gmail');
    if(gmailInput) gmailInput.value = data.email;
    if(avatarPreview) avatarPreview.src = data.picture;
    localStorage.setItem('fed_pic', data.picture);
    localStorage.setItem('fed_email', data.email);
  }catch(e){}
}
function closeProfile(){
  const has = localStorage.getItem('fed_name') || localStorage.getItem('chat_username');
  if(!has){ alert('Please set profile first'); return; }
  if(usernameOverlay){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; }
  const closeBtn = document.getElementById('closeProfileBtn');
  if(closeBtn) closeBtn.style.display='none';
}
function updateChatHeader(){
  const name = localStorage.getItem('fed_name') || localStorage.getItem('chat_username') || currentUser || 'Guest';
  const gender = localStorage.getItem('fed_gender') || '';
  const room = localStorage.getItem('last_room') || currentRoom || 'general';
  if(currentRoomLabel) currentRoomLabel.textContent = `Room: ${room} | You: ${name}${gender? ' • '+gender : ''}`;
  if(chatInput){ chatInput.value = ''; chatInput.placeholder = `${name} • #${room} > Type a message...`; }
}
if(usernameBtn){
  usernameBtn.addEventListener('click', async ()=>{
    const name = usernameInput.value.trim();
    const genderEl = document.getElementById('p_gender');
    const gmailEl = document.getElementById('p_gmail');
    const gender = genderEl? genderEl.value : '';
    const gmail = gmailEl? gmailEl.value.trim() : '';
    if(!name) return alert("Enter your name");
    if(!gender) return alert("Please select gender");
    usernameBtn.textContent="Saving..."; usernameBtn.disabled=true;
    let avatarUrl=currentAvatar;
    try{
      await ensureAuth();
      const file=avatarInput&&avatarInput.files[0];
      if(file){
        const fileName=`${currentUserId}_${Date.now()}_${file.name}`;
        const { error }=await supabaseClient.storage.from('avatars').upload(fileName,file);
        if(error) throw error;
        const { data }=supabaseClient.storage.from('avatars').getPublicUrl(fileName);
        avatarUrl=data.publicUrl;
      } else if(localStorage.getItem('fed_pic')){ avatarUrl = localStorage.getItem('fed_pic'); }
      currentUser=name; currentAvatar=avatarUrl;
      localStorage.setItem('chat_username',name);
      localStorage.setItem('fed_name',name);
      localStorage.setItem('fed_gender',gender);
      if(gmail) localStorage.setItem('fed_email',gmail);
      if(avatarUrl) localStorage.setItem('chat_avatar',avatarUrl);
      await supabaseClient.from('user_profiles').upsert([{ id:currentUserId, username:name, avatar_url:avatarUrl }],{ onConflict:'id' });
      if(usernameOverlay){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; }
      updateChatHeader(); loadMessages(); connectToRealtimeStream();
    }catch(err){ alert("Error: "+err.message); }finally{ usernameBtn.textContent="Save & Enter Chat"; usernameBtn.disabled=false; }
  });
}
async function loadMessages(){
  const { data, error }=await supabaseClient.from('messages').select('*').eq('room_id',currentRoom).order('created_at',{ascending:true});
  if(error){ console.error(error); return; }
  if(chatMessages) chatMessages.innerHTML="";
  if(data && chatMessages) data.forEach(m=> appendMessageToFeed(m.text,m.file_url,m.file_type,m.sender_name,m.avatar_url,m.sender_id===currentUserId,m.created_at,m.id));
  updateChatHeader(); clearBadge(); createBadgeUI(); setupPresence();
}
function appendMessageToFeed(text,fileUrl,fileType,senderName,avatarUrl,isOwn=false,createdAt=null,messageId=null){
  if(!chatMessages) return;
  let replyData = null; let displayText = text;
  if(text && text.startsWith('[REPLY_JSON]')){
    try{ const endIdx = text.indexOf('[/REPLY_JSON]'); if(endIdx > 0){ const jsonStr = text.substring(12, endIdx); replyData = JSON.parse(jsonStr); displayText = text.substring(endIdx+13); } }catch(e){}
  }
  const row=document.createElement('div');
  row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end';
  row.style.maxWidth='75%'; row.style.alignSelf=isOwn?'flex-end':'flex-start';
  if(isOwn) row.style.marginLeft='auto';
  let avatarEl;
  if(avatarUrl){ avatarEl=document.createElement('img'); avatarEl.src=avatarUrl; avatarEl.style.cssText='width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; cursor:pointer;'; }
  else { avatarEl=document.createElement('div'); avatarEl.textContent=(senderName||'?').charAt(0).toUpperCase(); avatarEl.style.cssText='width:32px; height:32px; border-radius:50%; background:#4a148c; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; cursor:pointer;'; }
  avatarEl.onclick=()=>openProfileView(senderName,avatarUrl);
  const bubble=document.createElement('div'); bubble.classList.add('message',isOwn?'outgoing':'incoming'); if(messageId) bubble.setAttribute('data-id',messageId);
  if(replyData){ const quote=document.createElement('div'); quote.style.cssText='border-left:3px solid '+(isOwn?'rgba(255,255,255,0.7)':'#4a148c')+'; background:'+(isOwn?'rgba(0,0,0,0.15)':'#f5f0ff')+'; padding:6px 8px; border-radius:6px; margin-bottom:6px;'; quote.innerHTML=`<b style="font-size:11px;">${replyData.sender_name}</b><br><span style="font-size:11px;">${replyData.text || (replyData.file_url? '📷 Photo' : '')}</span>`; bubble.appendChild(quote); }
  if(!isOwn && senderName){ const b=document.createElement('b'); b.textContent=senderName; b.style.cssText='font-size:12px; color:#075e54; display:block; margin-bottom:2px; cursor:pointer;'; b.onclick=()=>openProfileView(senderName,avatarUrl); bubble.appendChild(b); }
  if(displayText){ const s=document.createElement('div'); s.textContent=displayText; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; bubble.appendChild(s); }
  if(fileUrl){
    if(fileType?.startsWith('image/')){ const img=document.createElement('img'); img.src=fileUrl; img.style.cssText='max-width:200px; border-radius:8px; margin-top:5px; cursor:pointer;'; img.onclick=()=>openFullImage(fileUrl); bubble.appendChild(img); }
    else if(fileType?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=fileUrl; a.controls=true; a.style.cssText='max-width:220px; margin-top:6px; display:block;'; bubble.appendChild(a); }
    else { const a=document.createElement('a'); a.href=fileUrl; a.target='_blank'; a.textContent='📄 '+(displayText||'View File'); bubble.appendChild(a); }
  }
  const meta=document.createElement('div'); meta.style.cssText='display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:4px;';
  const timeSpan=document.createElement('span'); timeSpan.textContent=formatTime(createdAt||new Date()); timeSpan.style.fontSize='10px'; meta.appendChild(timeSpan);
  const replyBtn=document.createElement('span'); replyBtn.textContent='↩ Reply'; replyBtn.style.cssText='font-size:11px; cursor:pointer; opacity:0; color:'+(isOwn?'rgba(255,255,255,0.9)':'#4a148c')+'; font-weight:bold;'; replyBtn.onclick=()=>setReply(messageId, senderName, displayText, fileUrl); meta.appendChild(replyBtn);
  bubble.addEventListener('mouseenter', ()=> replyBtn.style.opacity='1'); bubble.addEventListener('mouseleave', ()=> replyBtn.style.opacity='0');
  if(isOwn && messageId){ const del=document.createElement('span'); del.textContent='× Delete'; del.style.cursor='pointer'; del.style.fontSize='11px'; del.addEventListener('click', async()=>{ if(confirm("Delete?")){ const { error }=await supabaseClient.from('messages').delete().eq('id',messageId); if(error) alert(error.message); } }); meta.appendChild(del); }
  bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}
let lastSend = 0;
async function sendMessage(){
  if(Date.now() - lastSend < 800) return; lastSend = Date.now();
  if(!currentUser){ if(usernameOverlay){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; } return alert("Set your name first"); }
  await ensureAuth();
  let finalText = chatInput? chatInput.value.trim() : "";
  if(pendingReply){ const replyJson = JSON.stringify({ sender_name: pendingReply.sender_name, text: pendingReply.text.substring(0,80), file_url: pendingReply.file_url }); finalText = `[REPLY_JSON]${replyJson}[/REPLY_JSON]` + finalText; }
  if(pendingFile){
    const file=pendingFile; const caption=finalText || file.name;
    if(sendBtn){ sendBtn.textContent="..."; sendBtn.disabled=true; }
    try{
      const fileName=`${currentRoom}/${currentUserId}_${Date.now()}_${file.name}`;
      const { error }=await supabaseClient.storage.from('chat-files').upload(fileName,file);
      if(error) throw error;
      const { data }=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
      await supabaseClient.from('messages').insert([{ text:caption, room_id:currentRoom, file_url:data.publicUrl, file_type:file.type, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]);
      clearFilePreview(); clearReply(); if(chatInput) chatInput.value="";
    }catch(err){ alert(err.message); }
    if(sendBtn){ sendBtn.textContent="Send"; sendBtn.disabled=false; } return;
  }
  const textWithoutTag = finalText.replace(/\[REPLY_JSON\].*?\[\/REPLY_JSON\]/,'').trim();
  if(!textWithoutTag) { if(chatInput) chatInput.value=""; clearReply(); return; }
  if(chatInput) chatInput.value=""; clearReply();
  const { error }=await supabaseClient.from('messages').insert([{ text:finalText, room_id:currentRoom, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]);
  if(error) alert(error.message);
}
async function attemptJoinRoom(){
  if(!currentUser){ if(usernameOverlay){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; } return alert("Enter your name first"); }
  const name=(roomInput?roomInput.value.trim():"") || (document.getElementById('drawer-room-input')?.value.trim()||"");
  if(!name) return alert("Enter room name");
  pendingRoom=name;
  const { data }=await supabaseClient.from('rooms').select('*').eq('id',name).maybeSingle();
  if(!data){ pendingMode='create'; if(roomPassTitle) roomPassTitle.textContent='Create Password'; if(roomPassDesc) roomPassDesc.textContent=`"${name}" is new. Set password`; }
  else { pendingMode='join'; if(roomPassTitle) roomPassTitle.textContent='Enter Password'; if(roomPassDesc) roomPassDesc.textContent=`"${name}" is private`; }
  if(roomPassInput) roomPassInput.value=""; if(roomPassError) roomPassError.textContent=""; if(roomPassOverlay) roomPassOverlay.classList.remove('hidden');
}
async function confirmRoomPassword(){
  const pass=roomPassInput?roomPassInput.value.trim():""; if(!pass){ if(roomPassError) roomPassError.textContent="Enter password"; return; }
  if(roomPassBtn){ roomPassBtn.textContent="Checking..."; roomPassBtn.disabled=true; }
  if(pendingMode==='create'){
    const hashed = await hashPass(pass);
    const { error }=await supabaseClient.from('rooms').insert([{id:pendingRoom,password_hash:hashed}]);
    if(error){ if(roomPassError) roomPassError.textContent=error.message; if(roomPassBtn){ roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; } return; }
  } else {
    const hashed = await hashPass(pass);
    const { data }=await supabaseClient.from('rooms').select('*').eq('id',pendingRoom).eq('password_hash',hashed).maybeSingle();
    if(!data){ if(roomPassError) roomPassError.textContent="Wrong password!"; if(roomPassBtn){ roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; } return; }
  }
  currentRoom=pendingRoom; saveJoinedRoom(currentRoom);
  if(roomPassOverlay) roomPassOverlay.classList.add('hidden');
  if(roomPassBtn){ roomPassBtn.textContent="Join Room"; roomPassBtn.disabled=false; }
  loadMessages(); connectToRealtimeStream();
}
function connectToRealtimeStream(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel(`chat-${currentRoom}`)
.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${currentRoom}`},p=>{
      const isOwn=p.new.sender_id===currentUserId;
      appendMessageToFeed(p.new.text,p.new.file_url,p.new.file_type,p.new.sender_name,p.new.avatar_url,isOwn,p.new.created_at,p.new.id);
      if(!isOwn){ playNativeChime(); if(chatMessages){ const atBottom=chatMessages.scrollTop+chatMessages.clientHeight>=chatMessages.scrollHeight-120; if(document.hidden||!atBottom) incrementBadge(); } }
    })
.on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{
      if(!chatMessages) return; const el=chatMessages.querySelector(`[data-id="${p.old.id}"]`); if(el&&el.parentElement) el.parentElement.remove();
    }).subscribe();
  setupPresence();
}
if(joinBtn) joinBtn.addEventListener('click',attemptJoinRoom);
if(roomPassBtn) roomPassBtn.addEventListener('click',confirmRoomPassword);
if(roomPassClose) roomPassClose.addEventListener('click',()=>{ if(roomPassOverlay) roomPassOverlay.classList.add('hidden'); });
if(sendBtn) sendBtn.addEventListener('click',sendMessage);
if(chatInput) chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); if(chatInput.value.trim()!==''||pendingFile) sendMessage(); } });
if(fileInput) fileInput.addEventListener('change', ()=>{ const f=fileInput.files[0]; if(!f) return; showFilePreview(f); });
let mediaRecorder=null, audioChunks=[], recordingSeconds=0, audioStream=null;
const micBtn=document.getElementById('mic-btn');
function getSupportedMime(){ if(MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'; if(MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'; if(MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'; return 'audio/webm'; }
async function startRecording(){
  try{
    audioStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimeType=getSupportedMime(); mediaRecorder=new MediaRecorder(audioStream,{mimeType}); audioChunks=[];
    mediaRecorder.ondataavailable=e=>{ if(e.data&&e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop=()=>{ if(audioChunks.length===0) return; const blob=new Blob(audioChunks,{type:mimeType}); if(blob.size<800){ clearFilePreview(); return; } const ext=mimeType.includes('mp4')?'m4a':'webm'; const file=new File([blob],`voicenote_${Date.now()}.${ext}`,{type:mimeType}); showFilePreview(file); };
    mediaRecorder.start(100); if(micBtn) micBtn.classList.add('recording');
  }catch(err){ alert("Mic denied: "+err.message); stopRecording(true); }
}
function stopRecording(cancel=false){
  try{ if(mediaRecorder&&mediaRecorder.state!=='inactive'){ if(cancel){ audioChunks=[]; mediaRecorder.onstop=null; } mediaRecorder.stop(); } }catch(e){}
  if(audioStream){ audioStream.getTracks().forEach(t=>t.stop()); audioStream=null; }
  if(micBtn) micBtn.classList.remove('recording'); if(cancel) clearFilePreview();
}
if(micBtn){ micBtn.onclick=()=>{ if(micBtn.classList.contains('recording')) stopRecording(false); else startRecording(); }; }
if(togglePass) togglePass.addEventListener('click',()=>{ if(!roomPassInput) return; roomPassInput.type=roomPassInput.type==='password'?'text':'password'; togglePass.textContent=roomPassInput.type==='password'?'👁️':'🙈'; });
function renderCommunitiesList(){
  let container=document.getElementById('communities-list');
  if(!container){
    const box=usernameOverlay?usernameOverlay.querySelector('.password-box'):null; if(!box) return; if(document.getElementById('communities-wrapper')) return;
    const wrapper=document.createElement('div'); wrapper.id='communities-wrapper';
    wrapper.innerHTML=`<hr style="margin:12px 0; border:none; border-top:1px solid #eee;"><p style="text-align:left; font-weight:bold; font-size:13px; margin-bottom:8px;">List of Communities</p><div id="communities-list" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; text-align:left;"></div>`;
    box.appendChild(wrapper); container=document.getElementById('communities-list');
  }
  const rooms=getJoinedRooms();
  if(rooms.length===0){ container.innerHTML=`<p style="font-size:12px; color:#888;">No communities yet.</p>`; return; }
  container.innerHTML="";
  rooms.forEach(r=>{
    const item=document.createElement('div'); item.style.cssText="display:flex; justify-content:space-between; align-items:center; background:#f5f0ff; padding:8px 10px; border-radius:8px; cursor:pointer;";
    item.innerHTML=`<span style="font-size:13px; font-weight:600;"># ${r}</span><span style="font-size:11px; color:#4a148c;">Tap to join</span>`;
    item.onclick=async()=>{ currentRoom=r; localStorage.setItem('last_room',r); if(usernameOverlay){ usernameOverlay.classList.add('hidden'); usernameOverlay.style.display='none'; } pendingRoom=r; const { data }=await supabaseClient.from('rooms').select('*').eq('id',r).maybeSingle(); if(!data){ alert("Room no longer exists"); return; } pendingMode='join'; if(roomPassTitle) roomPassTitle.textContent='Enter Password'; if(roomPassDesc) roomPassDesc.textContent=`"${r}" is private`; if(roomPassInput) roomPassInput.value=""; if(roomPassError) roomPassError.textContent=""; if(roomPassOverlay) roomPassOverlay.classList.remove('hidden'); };
    container.appendChild(item);
  });
}
const changeProfileBtn=document.getElementById('change-profile-btn');
if(changeProfileBtn){
  changeProfileBtn.addEventListener('click', ()=>{
    const name = localStorage.getItem('fed_name') || localStorage.getItem('chat_username') || '';
    const gender = localStorage.getItem('fed_gender') || '';
    const gmail = localStorage.getItem('fed_email') || '';
    if(usernameOverlay){ usernameOverlay.classList.remove('hidden'); usernameOverlay.style.display='flex'; }
    if(usernameInput) usernameInput.value=name;
    const gSel = document.getElementById('p_gender'); if(gSel) gSel.value=gender;
    const gMail = document.getElementById('p_gmail'); if(gMail) gMail.value=gmail;
    if(name){ const title = document.getElementById('profileTitle'); if(title) title.innerText='Edit Profile'; const closeBtn = document.getElementById('closeProfileBtn'); if(closeBtn) closeBtn.style.display='block'; }
    if(currentAvatar&&avatarPreview) avatarPreview.src=currentAvatar;
    setTimeout(renderCommunitiesList,80);
  });
}
window.addEventListener('DOMContentLoaded',()=>{ if(chatInput) chatInput.value=""; if(roomInput) roomInput.value=""; updateChatHeader(); });
if(chatInput) chatInput.value=""; if(roomInput) roomInput.value="";
function initChime(){ try{ notifAudioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
function playNativeChime(){
  try{
    if(!notifAudioCtx) initChime(); if(!notifAudioCtx) return; const now=notifAudioCtx.currentTime;
    [523.25,659.25,783.99].forEach((freq,i)=>{ const o=notifAudioCtx.createOscillator(); const g=notifAudioCtx.createGain(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(notifAudioCtx.destination); g.gain.setValueAtTime(0,now+i*0.08); g.gain.linearRampToValueAtTime(0.25,now+i*0.08+0.02); g.gain.exponentialRampToValueAtTime(0.001,now+i*0.08+0.35); o.start(now+i*0.08); o.stop(now+i*0.08+0.4); });
    if(navigator.vibrate) navigator.vibrate(60);
  }catch(e){}
}
function createBadgeUI(){
  if(document.getElementById('chat-notif-badge')) return;
  const label=document.getElementById('current-room-label'); if(!label) return; label.style.position='relative';
  const badge=document.createElement('span'); badge.id='chat-notif-badge'; badge.textContent='0';
  badge.style.cssText='position:absolute; top:-6px; right:-10px; background:#ff3b30; color:white; font-size:11px; font-weight:bold; min-width:18px; height:18px; border-radius:9px; display:none; align-items:center; justify-content:center; padding:0 5px; z-index:9;'; label.appendChild(badge);
}
createBadgeUI();
function updateBadge(count){ unreadCount=count; const badge=document.getElementById('chat-notif-badge'); if(!badge) return; if(count>0){ badge.textContent=count>99?'99+':count; badge.style.display='flex'; document.title=`(${count}) New message - ${currentRoom}`; } else { badge.style.display='none'; document.title=`Room: ${currentRoom}`; } }
function incrementBadge(){ updateBadge(unreadCount+1); } function clearBadge(){ updateBadge(0); }
document.addEventListener('click',()=>{ if(notifAudioCtx&&notifAudioCtx.state==='suspended') notifAudioCtx.resume(); });
if(chatMessages) chatMessages.addEventListener('scroll',()=>{ const atBottom=chatMessages.scrollTop+chatMessages.clientHeight>=chatMessages.scrollHeight-50; if(atBottom) clearBadge(); });
if(chatInput) chatInput.addEventListener('focus', clearBadge);
function ensurePickerUI(){
  if(document.getElementById('unified-picker')) return document.getElementById('unified-picker');
  const html = `<div id="unified-picker" class="hidden" style="position:fixed; bottom:70px; left:10px; right:10px; max-width:360px; background:white; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.2); z-index:9998; overflow:hidden; display:none; flex-direction:column;"><div style="display:flex; background:#f5f5f5; padding:6px; gap:6px;"><button class="picker-tab active" data-tab="emoji" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">😊 Emoji</button><button class="picker-tab" data-tab="sticker" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer;">⭐ Sticker</button><button class="picker-tab" data-tab="gif" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer;">🎞️ GIF</button></div><div id="tab-emoji" class="picker-content" style="max-height:320px; overflow:auto;"></div><div id="tab-sticker" class="picker-content hidden" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:10px; max-height:320px; overflow:auto;"></div><div id="tab-gif" class="picker-content hidden" style="padding:10px; max-height:320px; overflow:auto;"><input id="gif-search" placeholder="Search GIFs..." style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ddd; margin-bottom:8px;"><div id="gif-results" style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px;"></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', html); return document.getElementById('unified-picker');
}
const unifiedPicker = ensurePickerUI();
let emojiPickerInstance = null; let pickerOpenTab = null;
function openPicker(tab){
  const picker = ensurePickerUI(); if(!picker) return;
  if(picker.style.display!== 'none' && pickerOpenTab === tab){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; return; }
  picker.classList.remove('hidden'); picker.style.display='flex'; pickerOpenTab=tab;
  picker.querySelectorAll('.picker-tab').forEach(t=>{ const isActive = t.dataset.tab===tab; t.classList.toggle('active', isActive); t.style.background = isActive? '#4a148c' : 'transparent'; t.style.color = isActive? 'white' : '#333'; });
  picker.querySelectorAll('.picker-content').forEach(c=> { c.classList.add('hidden'); c.style.display='none'; });
  const el=document.getElementById(`tab-${tab}`); if(el){ el.classList.remove('hidden'); el.style.display = tab==='gif'?'block':'grid'; if(tab==='emoji') el.style.display='block'; }
  if(tab==='gif') searchGifs("trending"); if(tab==='emoji') ensureEmojiPicker(); if(tab==='sticker') renderStickers();
}
function ensureEmojiPicker(){
  const tabEmoji=document.getElementById('tab-emoji'); if(!tabEmoji) return; if(emojiPickerInstance) return; if(!window.EmojiMart) return;
  try{ emojiPickerInstance = new EmojiMart.Picker({ onEmojiSelect:(emoji)=>{ if(chatInput){ chatInput.value+=emoji.native; chatInput.focus(); } }, theme:'light', previewPosition:'none', perLine:8, emojiSize:22, parent: tabEmoji }); }catch(e){}
}
const attachBtn = document.getElementById('attach-btn'); const emojiBtn = document.getElementById('emoji-btn');
if(attachBtn){
  attachBtn.onclick=(e)=>{
    e.stopPropagation(); let menu = document.getElementById('attach-menu');
    if(!menu){ const m = document.createElement('div'); m.id='attach-menu'; m.className='hidden'; m.style.cssText='position:fixed; bottom:70px; left:10px; background:white; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,0.2); padding:8px; z-index:9997; display:none; flex-direction:column; gap:4px;'; m.innerHTML=`<button id="attach-photo" style="padding:10px 14px; border:none; background:transparent; text-align:left; cursor:pointer;">📷 Photo/Video</button><button id="attach-file" style="padding:10px 14px; border:none; background:transparent; text-align:left; cursor:pointer;">📄 File</button><button id="attach-gif" style="padding:10px 14px; border:none; background:transparent; text-align:left; cursor:pointer;">🎞️ GIF</button><button id="attach-sticker" style="padding:10px 14px; border:none; background:transparent; text-align:left; cursor:pointer;">⭐ Sticker</button>`; document.body.appendChild(m); menu=m;
      m.querySelector('#attach-photo').onclick=()=>{ menu.classList.add('hidden'); menu.style.display='none'; if(fileInput){ fileInput.accept="image/*,video/*"; fileInput.click(); } };
      m.querySelector('#attach-file').onclick=()=>{ menu.classList.add('hidden'); menu.style.display='none'; if(fileInput){ fileInput.accept=".pdf,.doc,.docx,.zip,.txt,image/*"; fileInput.click(); } };
      m.querySelector('#attach-gif').onclick=()=>{ menu.classList.add('hidden'); menu.style.display='none'; openPicker('gif'); };
      m.querySelector('#attach-sticker').onclick=()=>{ menu.classList.add('hidden'); menu.style.display='none'; openPicker('sticker'); };
    }
    if(menu.classList.contains('hidden') || menu.style.display==='none'){ menu.classList.remove('hidden'); menu.style.display='flex'; } else { menu.classList.add('hidden'); menu.style.display='none'; }
    const picker = document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; }
  };
}
if(emojiBtn){ emojiBtn.onclick=(e)=>{ e.stopPropagation(); const menu=document.getElementById('attach-menu'); if(menu){ menu.classList.add('hidden'); menu.style.display='none'; } openPicker('emoji'); }; }
document.addEventListener('click', (e)=>{ if(e.target.classList.contains('picker-tab')) openPicker(e.target.dataset.tab); });
const LOCAL_GIFS = ["https://media1.tenor.com/m/2uyENRuvV-0AAAAC/coding.gif","https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif"];
function searchGifs(q){ const gifResults=document.getElementById('gif-results'); if(!gifResults) return; gifResults.innerHTML=""; LOCAL_GIFS.forEach(full=>{ const img=document.createElement('img'); img.src=full; img.loading="lazy"; img.style.cssText="width:100%; height:110px; object-fit:cover; border-radius:8px; cursor:pointer; background:#f0f0f0;"; img.onclick=async()=>{ await ensureAuth(); await supabaseClient.from('messages').insert([{ text:"", room_id:currentRoom, file_url:full, file_type:"image/gif", sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); const picker=document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; } }; gifResults.appendChild(img); }); }
const stickerPack=["https://cdn-icons-png.flaticon.com/512/742/742751.png","https://cdn-icons-png.flaticon.com/512/2584/2584606.png","https://cdn-icons-png.flaticon.com/512/826/826963.png","https://cdn-icons-png.flaticon.com/512/616/616490.png","https://cdn-icons-png.flaticon.com/512/742/742752.png","https://cdn-icons-png.flaticon.com/512/833/833472.png"];
function renderStickers(){ const tabSticker=document.getElementById('tab-sticker'); if(!tabSticker) return; if(tabSticker.dataset.rendered==="1") return; tabSticker.innerHTML=""; stickerPack.forEach(url=>{ const im=document.createElement('img'); im.src=url; im.loading="lazy"; im.style.cssText="width:70px; height:70px; object-fit:contain; cursor:pointer; background:#f9f9f9; border-radius:12px; padding:6px;"; im.onclick=async()=>{ await ensureAuth(); await supabaseClient.from('messages').insert([{ text:"", room_id:currentRoom, file_url:url, file_type:"image/webp", sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); const picker=document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; } }; tabSticker.appendChild(im); }); tabSticker.dataset.rendered="1"; }
renderStickers();
const generalBtn = document.getElementById('general-btn');
if(generalBtn){ generalBtn.onclick = async () => { currentRoom = "general"; saveJoinedRoom("general"); loadMessages(); connectToRealtimeStream(); const picker=document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; } }; }
document.addEventListener('click', (e) => {
  const picker=document.getElementById('unified-picker'); const menu=document.getElementById('attach-menu');
  if(picker && picker.style.display!=='none'){ const isPicker = picker.contains(e.target); const isEmojiBtn = e.target.closest('#emoji-btn'); const isAttachBtn = e.target.closest('#attach-btn'); const isTab = e.target.classList.contains('picker-tab'); if(!isPicker &&!isEmojiBtn &&!isAttachBtn &&!isTab){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; } }
  if(menu && menu.style.display!=='none'){ if(!menu.contains(e.target) &&!e.target.closest('#attach-btn')){ menu.classList.add('hidden'); menu.style.display='none'; } }
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){
    const picker=document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; }
    const menu=document.getElementById('attach-menu'); if(menu){ menu.classList.add('hidden'); menu.style.display='none'; }
    const po = document.getElementById('profile-overlay'); if(po) po.classList.add('hidden');
    const fp = document.getElementById('full-pic-overlay'); if(fp) fp.classList.add('hidden');
    if(roomPassOverlay) roomPassOverlay.classList.add('hidden');
  }
});
if(chatMessages){ chatMessages.addEventListener('click', () => { const picker=document.getElementById('unified-picker'); if(picker){ picker.classList.add('hidden'); picker.style.display='none'; pickerOpenTab=null; } const menu=document.getElementById('attach-menu'); if(menu){ menu.classList.add('hidden'); menu.style.display='none'; } }); }
const replyPreview = document.getElementById('reply-preview'); const replyToName = document.getElementById('reply-to-name'); const replyToText = document.getElementById('reply-to-text'); const replyCancelBtn = document.getElementById('reply-cancel');
function setReply(id, senderName, text, fileUrl){ pendingReply = { id, sender_name: senderName, text: text||"", file_url: fileUrl||"" }; if(replyToName) replyToName.textContent = "Replying to " + senderName; if(replyToText) replyToText.textContent = text || (fileUrl? "📷 Photo" : "Message"); if(replyPreview){ replyPreview.classList.remove('hidden'); replyPreview.style.display='flex'; } if(chatInput) chatInput.focus(); }
function clearReply(){ pendingReply = null; if(replyPreview){ replyPreview.classList.add('hidden'); replyPreview.style.display='none'; } }
if(replyCancelBtn) replyCancelBtn.onclick = clearReply;