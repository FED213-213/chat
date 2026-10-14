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
let currentUser = localStorage.getItem('chat_username') || null;
let currentAvatar = localStorage.getItem('chat_avatar') || null;
let currentUserId = null;
let pendingRoom = null, pendingMode = null, realtimeChannel = null;
let pendingFile = null;
let pendingReply = null;
let unreadCount = 0;
let notifAudioCtx = null;

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
    if(usernameOverlay) usernameOverlay.classList.add('hidden');
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
  <div id="profile-overlay" class="password-overlay hidden" style="z-index:10000;">
    <div class="password-box" style="padding:0; overflow:hidden; max-width:340px;">
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
  <div id="full-pic-overlay" class="password-overlay hidden" style="z-index:10001; background:rgba(0,0,0,0.9);">
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

function openProfile(senderName, avatarUrl){
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

// ONLINE PRESENCE - SAFE, WON'T CRASH
let presenceChannel;
async function setupPresence(){
  try {
    const userId = currentUserId;
    if(!userId) return;
    await supabaseClient.from('user_profiles').upsert({ id: userId, username: currentUser, avatar_url: currentAvatar }, {onConflict:'id'});
    if(presenceChannel) supabaseClient.removeChannel(presenceChannel);
    presenceChannel = supabaseClient.channel('online-users');
    presenceChannel.on('presence', {event:'sync'}, () => {
      const state = presenceChannel.presenceState();
      updateOnlineList(state);
    }).subscribe(async (status)=>{
      if(status === 'SUBSCRIBED'){
        await presenceChannel.track({ user_id: userId, online_at: new Date().toISOString() });
      }
    });
  } catch(e) {
    console.log("presence skipped, chat still works", e.message);
  }
}
function updateOnlineList(state){
  console.log("Online now:", Object.keys(state).length);
}

if(avatarInput){
  avatarInput.addEventListener('change', ()=>{
    const f=avatarInput.files[0]; if(!f||!avatarPreview) return;
    avatarPreview.src=URL.createObjectURL(f);
  });
}

if(usernameBtn){
  usernameBtn.addEventListener('click', async ()=>{
    const name=usernameInput.value.trim(); if(!name) return alert("Enter your name");
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
      }
      currentUser=name; currentAvatar=avatarUrl;
      localStorage.setItem('chat_username',name);
      localStorage.setItem('chat_has_account','true');
      localStorage.setItem('chat_user_profile', JSON.stringify({id: currentUserId, name}));
      if(avatarUrl) localStorage.setItem('chat_avatar',avatarUrl);
      await supabaseClient.from('user_profiles').upsert([{ id:currentUserId, username:name, avatar_url:avatarUrl }],{ onConflict:'id' });
      if(usernameOverlay) usernameOverlay.classList.add('hidden');
      loadMessages(); connectToRealtimeStream();
    }catch(err){ alert("Error: "+err.message); }finally{ usernameBtn.textContent="Continue"; usernameBtn.disabled=false; }
  });
}

async function loadMessages(){
  const { data, error }=await supabaseClient.from('messages').select('*').eq('room_id',currentRoom).order('created_at',{ascending:true});
  if(error){ console.error(error); return; }
  if(chatMessages) chatMessages.innerHTML="";
  if(data && chatMessages) data.forEach(m=> appendMessageToFeed(m.text,m.file_url,m.file_type,m.sender_name,m.avatar_url,m.sender_id===currentUserId,m.created_at,m.id));
  if(currentRoomLabel) currentRoomLabel.textContent=`Room: ${currentRoom} | You: ${currentUser||'Guest'}`;
  clearBadge(); createBadgeUI();
  setupPresence();
}

function appendMessageToFeed(text,fileUrl,fileType,senderName,avatarUrl,isOwn=false,createdAt=null,messageId=null){
  if(!chatMessages) return;
  let replyData = null;
  let displayText = text;
  if(text && text.startsWith('[REPLY_JSON]')){
    try{
      const endIdx = text.indexOf('[/REPLY_JSON]');
      if(endIdx > 0){
        const jsonStr = text.substring(12, endIdx);
        replyData = JSON.parse(jsonStr);
        displayText = text.substring(endIdx+13);
      }
    }catch(e){}
  }
  const row=document.createElement('div');
  row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end';
  row.style.maxWidth='75%'; row.style.alignSelf=isOwn?'flex-end':'flex-start';
  if(isOwn) row.style.marginLeft='auto';
  row.style.position='relative';
  let avatarEl;
  if(avatarUrl){ avatarEl=document.createElement('img'); avatarEl.src=avatarUrl; avatarEl.style.cssText='width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; cursor:pointer;'; }
  else { avatarEl=document.createElement('div'); avatarEl.textContent=(senderName||'?').charAt(0).toUpperCase(); avatarEl.style.cssText='width:32px; height:32px; border-radius:50%; background:#4a148c; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; cursor:pointer;'; }
  avatarEl.onclick=()=>openProfile(senderName,avatarUrl);
  const bubble=document.createElement('div');
  bubble.classList.add('message',isOwn?'outgoing':'incoming');
  if(messageId) bubble.setAttribute('data-id',messageId);
  bubble.style.position='relative';
  if(replyData){
    const quote=document.createElement('div');
    quote.style.cssText='border-left:3px solid '+(isOwn?'rgba(255,255,255,0.7)':'#4a148c')+'; background:'+(isOwn?'rgba(0,0,0,0.15)':'#f5f0ff')+'; padding:6px 8px; border-radius:6px; margin-bottom:6px; cursor:pointer;';
    quote.innerHTML=`<b style="font-size:11px; display:block;">${replyData.sender_name}</b><span style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; max-width:160px;">${replyData.text || (replyData.file_url? '📷 Photo' : '')}</span>`;
    bubble.appendChild(quote);
  }
  if(!isOwn && senderName){ const b=document.createElement('b'); b.textContent=senderName; b.style.cssText='font-size:12px; color:#075e54; display:block; margin-bottom:2px; cursor:pointer;'; b.onclick=()=>openProfile(senderName,avatarUrl); bubble.appendChild(b); }
  if(displayText){ const s=document.createElement('div'); s.textContent=displayText; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; bubble.appendChild(s); }
  if(fileUrl){
    if(fileType?.startsWith('image/')){
      const img=document.createElement('img'); img.src=fileUrl; img.style.cssText='max-width:200px; border-radius:8px; margin-top:5px; cursor:pointer;'; img.onclick=()=>openFullImage(fileUrl); bubble.appendChild(img);
    } else if(fileType?.startsWith('audio/')){
      const a=document.createElement('audio'); a.src=fileUrl; a.controls=true; a.style.cssText='max-width:220px; margin-top:6px; display:block;'; bubble.appendChild(a);
    } else {
      const a=document.createElement('a'); a.href=fileUrl; a.target='_blank'; a.textContent='📄 '+(displayText||'View File'); bubble.appendChild(a);
    }
  }
  const meta=document.createElement('div'); meta.style.cssText='display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:4px;';
  const timeSpan=document.createElement('span'); timeSpan.classList.add('chat-timestamp'); timeSpan.textContent=formatTime(createdAt||new Date()); meta.appendChild(timeSpan);
  const replyBtn=document.createElement('span');
  replyBtn.textContent='↩ Reply';
  replyBtn.style.cssText='font-size:11px; cursor:pointer; opacity:0; transition:0.2s; color:'+(isOwn?'rgba(255,255,255,0.9)':'#4a148c')+'; font-weight:bold;';
  replyBtn.onclick=()=>setReply(messageId, senderName, displayText, fileUrl);
  meta.appendChild(replyBtn);
  bubble.addEventListener('mouseenter', ()=> replyBtn.style.opacity='1');
  bubble.addEventListener('mouseleave', ()=> replyBtn.style.opacity='0');
  if(isOwn && messageId){ const del=document.createElement('span'); del.classList.add('delete-btn'); del.textContent='× Delete'; del.style.cursor='pointer'; del.addEventListener('click', async()=>{ if(confirm("Delete?")){ const { error }=await supabaseClient.from('messages').delete().eq('id',messageId); if(error) alert(error.message); } }); meta.appendChild(del); }
  bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}

let lastSend = 0;
async function sendMessage(){
  if(Date.now() - lastSend < 800) return;
  lastSend = Date.now();
  if(!currentUser){ if(usernameOverlay) usernameOverlay.classList.remove('hidden'); return alert("Set your name first"); }
  await ensureAuth();
  let finalText = chatInput? chatInput.value.trim() : "";
  if(pendingReply){
    const replyJson = JSON.stringify({ sender_name: pendingReply.sender_name, text: pendingReply.text.substring(0,80), file_url: pendingReply.file_url });
    finalText = `[REPLY_JSON]${replyJson}[/REPLY_JSON]` + finalText;
  }
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
    if(sendBtn){ sendBtn.textContent="Send"; sendBtn.disabled=false; }
    return;
  }
  const textWithoutTag = finalText.replace(/\[REPLY_JSON\].*?\[\/REPLY_JSON\]/,'').trim();
  if(!textWithoutTag) { if(chatInput) chatInput.value=""; clearReply(); return; }
  if(chatInput) chatInput.value="";
  clearReply();
  const { error }=await supabaseClient.from('messages').insert([{ text:finalText, room_id:currentRoom, sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]);
  if(error) alert(error.message);
}

async function attemptJoinRoom(){
  if(!currentUser){ if(usernameOverlay) usernameOverlay.classList.remove('hidden'); return alert("Enter your name first"); }
  const name=roomInput?roomInput.value.trim():""; if(!name) return alert("Enter room name");
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
  currentRoom=pendingRoom; localStorage.setItem('last_room',currentRoom); saveJoinedRoom(currentRoom);
  if(roomPassOverlay) roomPassOverlay.classList.add('hidden'); if(roomPassBtn){ roomPassBtn.textContent="Join Room"; roomPassBtn.disabled=false; } loadMessages(); connectToRealtimeStream();
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
      if(!chatMessages) return;
      const el=chatMessages.querySelector(`[data-id="${p.old.id}"]`); if(el&&el.parentElement) el.parentElement.remove();
    })
.subscribe();
}

if(joinBtn) joinBtn.addEventListener('click',attemptJoinRoom);
if(roomPassBtn) roomPassBtn.addEventListener('click',confirmRoomPassword);
if(roomPassClose) roomPassClose.addEventListener('click',()=>{ if(roomPassOverlay) roomPassOverlay.classList.add('hidden'); });
if(sendBtn) sendBtn.addEventListener('click',sendMessage);
if(chatInput) chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); if(chatInput.value.trim()!==''||pendingFile) sendMessage(); } });
if(fileInput) fileInput.addEventListener('change', ()=>{ const f=fileInput.files[0]; if(!f) return; showFilePreview(f); });

let mediaRecorder=null, audioChunks=[], recordingTimer=null, recordingSeconds=0, audioStream=null;
const micBtn=document.getElementById('mic-btn');
const recordingPreview=document.getElementById('recording-preview');
const recordingTime=document.getElementById('recording-time');
const recordingCancel=document.getElementById('recording-cancel');
const recordingStop=document.getElementById('recording-stop');
function formatRecTime(s){ const m=String(Math.floor(s/60)).padStart(2,'0'); const sec=String(s%60).padStart(2,'0'); return `${m}:${sec}`; }
function getSupportedMime(){ if(MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'; if(MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'; if(MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'; return 'audio/webm'; }
async function startRecording(){
  try{
    audioStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimeType=getSupportedMime();
    mediaRecorder=new MediaRecorder(audioStream,{mimeType});
    audioChunks=[]; recordingSeconds=0;
    mediaRecorder.ondataavailable=e=>{ if(e.data&&e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop=()=>{ clearInterval(recordingTimer); if(audioChunks.length===0) return; const blob=new Blob(audioChunks,{type:mimeType}); if(blob.size<800){ clearFilePreview(); return; } const ext=mimeType.includes('mp4')?'m4a':'webm'; const file=new File([blob],`voicenote_${Date.now()}.${ext}`,{type:mimeType}); showFilePreview(file); };
    mediaRecorder.start(100);
    if(micBtn) micBtn.classList.add('recording');
    if(recordingPreview){ recordingPreview.classList.remove('hidden'); recordingPreview.style.display='flex'; }
    if(recordingTime) recordingTime.textContent='00:00';
    recordingTimer=setInterval(()=>{ recordingSeconds++; if(recordingTime) recordingTime.textContent=formatRecTime(recordingSeconds); },1000);
  }catch(err){ alert("Mic denied: "+err.message); stopRecording(true); }
}
function stopRecording(cancel=false){
  try{ if(mediaRecorder&&mediaRecorder.state!=='inactive'){ if(cancel){ audioChunks=[]; mediaRecorder.onstop=null; } mediaRecorder.stop(); } }catch(e){}
  if(audioStream){ audioStream.getTracks().forEach(t=>t.stop()); audioStream=null; }
  clearInterval(recordingTimer);
  if(micBtn) micBtn.classList.remove('recording');
  if(recordingPreview){ recordingPreview.classList.add('hidden'); recordingPreview.style.display='none'; }
  if(cancel) clearFilePreview();
}
if(micBtn){ micBtn.onclick=()=>{ if(micBtn.classList.contains('recording')) stopRecording(false); else startRecording(); }; }
if(recordingStop) recordingStop.onclick=()=>stopRecording(false);
if(recordingCancel) recordingCancel.onclick=()=>stopRecording(true);
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
    item.onclick=async()=>{ currentRoom=r; localStorage.setItem('last_room',r); if(usernameOverlay) usernameOverlay.classList.add('hidden'); pendingRoom=r; const { data }=await supabaseClient.from('rooms').select('*').eq('id',r).maybeSingle(); if(!data){ alert("Room no longer exists"); return; } pendingMode='join'; if(roomPassTitle) roomPassTitle.textContent='Enter Password'; if(roomPassDesc) roomPassDesc.textContent=`"${r}" is private`; if(roomPassInput) roomPassInput.value=""; if(roomPassError) roomPassError.textContent=""; if(roomPassOverlay) roomPassOverlay.classList.remove('hidden'); };
    container.appendChild(item);
  });
}
const changeProfileBtn=document.getElementById('change-profile-btn');
if(changeProfileBtn){
  changeProfileBtn.addEventListener('click', ()=>{
    if(usernameOverlay) usernameOverlay.classList.remove('hidden');
    if(usernameInput) usernameInput.value=currentUser||"";
    if(currentAvatar&&avatarPreview) avatarPreview.src=currentAvatar;
    setTimeout(renderCommunitiesList,80);
  });
}
window.addEventListener('DOMContentLoaded',()=>{ if(chatInput) chatInput.value=""; if(roomInput) roomInput.value=""; });
if(chatInput) chatInput.value=""; if(roomInput) roomInput.value="";

function initChime(){ try{ notifAudioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
function playNativeChime(){
  try{
    if(!notifAudioCtx) initChime(); if(!notifAudioCtx) return;
    const now=notifAudioCtx.currentTime;
    [523.25,659.25,783.99].forEach((freq,i)=>{ const o=notifAudioCtx.createOscillator(); const g=notifAudioCtx.createGain(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(notifAudioCtx.destination); g.gain.setValueAtTime(0,now+i*0.08); g.gain.linearRampToValueAtTime(0.25,now+i*0.08+0.02); g.gain.exponentialRampToValueAtTime(0.001,now+i*0.08+0.35); o.start(now+i*0.08); o.stop(now+i*0.08+0.4); });
    if(navigator.vibrate) navigator.vibrate(60);
  }catch(e){}
}
function createBadgeUI(){
  if(document.getElementById('chat-notif-badge')) return;
  const label=document.getElementById('current-room-label'); if(!label) return;
  label.style.position='relative';
  const badge=document.createElement('span'); badge.id='chat-notif-badge'; badge.textContent='0';
  badge.style.cssText='position:absolute; top:-6px; right:-10px; background:#ff3b30; color:white; font-size:11px; font-weight:bold; min-width:18px; height:18px; border-radius:9px; display:none; align-items:center; justify-content:center; padding:0 5px; z-index:9;';
  label.appendChild(badge);
}
createBadgeUI();
function updateBadge(count){
  unreadCount=count;
  const badge=document.getElementById('chat-notif-badge'); if(!badge) return;
  if(count>0){ badge.textContent=count>99?'99+':count; badge.style.display='flex'; document.title=`(${count}) New message - ${currentRoom}`; }
  else { badge.style.display='none'; document.title=`Room: ${currentRoom}`; }
}
function incrementBadge(){ updateBadge(unreadCount+1); }
function clearBadge(){ updateBadge(0); }
document.addEventListener('click',()=>{ if(notifAudioCtx&&notifAudioCtx.state==='suspended') notifAudioCtx.resume(); });
if(chatMessages) chatMessages.addEventListener('scroll',()=>{ const atBottom=chatMessages.scrollTop+chatMessages.clientHeight>=chatMessages.scrollHeight-50; if(atBottom) clearBadge(); });
if(chatInput) chatInput.addEventListener('focus', clearBadge);

const attachBtn=document.getElementById('attach-btn');
const attachMenu=document.getElementById('attach-menu');
const unifiedPicker=document.getElementById('unified-picker');
const attachPhoto=document.getElementById('attach-photo');
const attachFile=document.getElementById('attach-file');
const attachGifBtn=document.getElementById('attach-gif');
const attachStickerBtn=document.getElementById('attach-sticker');
const emojiBtn=document.getElementById('emoji-btn');

if(attachBtn){
  attachBtn.onclick=(e)=>{ e.stopPropagation(); if(attachMenu) attachMenu.classList.toggle('hidden'); if(unifiedPicker) unifiedPicker.classList.add('hidden'); };
}
if(attachPhoto) attachPhoto.onclick=()=>{ if(attachMenu) attachMenu.classList.add('hidden'); if(fileInput){ fileInput.accept="image/*,video/*"; fileInput.click(); } };
if(attachFile) attachFile.onclick=()=>{ if(attachMenu) attachMenu.classList.add('hidden'); if(fileInput){ fileInput.accept=".pdf,.doc,.docx,.zip,.txt,image/*"; fileInput.click(); } };
if(attachGifBtn) attachGifBtn.onclick=()=>{ if(attachMenu) attachMenu.classList.add('hidden'); openPicker('gif'); };
if(attachStickerBtn) attachStickerBtn.onclick=()=>{ if(attachMenu) attachMenu.classList.add('hidden'); openPicker('sticker'); };

function openPicker(tab){
  if(!unifiedPicker) return;
  unifiedPicker.classList.remove('hidden');
  document.querySelectorAll('.picker-tab').forEach(t=> t.classList.toggle('active', t.dataset.tab===tab));
  document.querySelectorAll('.picker-content').forEach(c=> c.classList.add('hidden'));
  const el=document.getElementById(`tab-${tab}`); if(el){ el.classList.remove('hidden'); el.style.display=tab==='gif'?'block':'grid'; if(tab==='emoji') el.style.display='block'; }
  if(tab==='gif') searchGifs("trending");
}
if(emojiBtn){
  emojiBtn.onclick=()=>{
    if(unifiedPicker &&!unifiedPicker.classList.contains('hidden') &&!document.getElementById('tab-emoji').classList.contains('hidden')){
      unifiedPicker.classList.add('hidden');
    } else {
      openPicker('emoji');
    }
  };
}
document.querySelectorAll('.picker-tab').forEach(tab=>{
  tab.onclick=()=> openPicker(tab.dataset.tab);
});

const tabEmoji=document.getElementById('tab-emoji');
if(tabEmoji && window.EmojiMart){
  const picker=new EmojiMart.Picker({
    onEmojiSelect:(emoji)=>{ if(chatInput){ chatInput.value+=emoji.native; chatInput.focus(); } },
    theme:'light', previewPosition:'none', perLine:8, emojiSize:22
  });
  tabEmoji.appendChild(picker);
}

const gifSearch=document.getElementById('gif-search');
const gifResults=document.getElementById('gif-results');
const LOCAL_GIFS = [
  "https://media1.tenor.com/m/2uyENRuvV-0AAAAC/coding.gif",
  "https://media1.tenor.com/m/3o6ZsVGl3uV0p6V6kM/aaaac/happy.gif",
  "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
  "https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif"
];

function searchGifs(q){
  if(!gifResults) return;
  gifResults.innerHTML="";
  LOCAL_GIFS.forEach(full=>{
    const img=document.createElement('img');
    img.src=full;
    img.loading="lazy";
    img.style.cssText="width:100%; height:110px; object-fit:cover; border-radius:8px; cursor:pointer; background:#f0f0f0;";
    img.onerror=()=>{ img.style.display='none'; };
    img.onclick=async()=>{ await ensureAuth(); await supabaseClient.from('messages').insert([{ text:"", room_id:currentRoom, file_url:full, file_type:"image/gif", sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); if(unifiedPicker) unifiedPicker.classList.add('hidden'); };
    gifResults.appendChild(img);
  });
}
if(gifSearch){ gifSearch.oninput=()=>searchGifs(gifSearch.value); }

const tabSticker=document.getElementById('tab-sticker');
const stickerPack=[
  "https://cdn-icons-png.flaticon.com/512/742/742751.png",
  "https://cdn-icons-png.flaticon.com/512/2584/2584606.png",
  "https://cdn-icons-png.flaticon.com/512/826/826963.png",
  "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"
];
if(tabSticker){
  tabSticker.innerHTML="";
  stickerPack.forEach(url=>{
    const im=document.createElement('img');
    im.src=url; im.style.cssText="width:70px; height:70px; object-fit:contain; cursor:pointer; background:#f9f9f9; border-radius:12px; padding:6px;";
    im.onclick=async()=>{ await ensureAuth(); await supabaseClient.from('messages').insert([{ text:"", room_id:currentRoom, file_url:url, file_type:"image/webp", sender_name:currentUser, avatar_url:currentAvatar, sender_id:currentUserId }]); if(unifiedPicker) unifiedPicker.classList.add('hidden'); };
    tabSticker.appendChild(im);
  });
}

const generalBtn = document.getElementById('general-btn');
if(generalBtn){
  generalBtn.onclick = async () => {
    currentRoom = "general";
    localStorage.setItem('last_room', "general");
    saveJoinedRoom("general");
    loadMessages();
    connectToRealtimeStream();
    if(unifiedPicker) unifiedPicker.classList.add('hidden');
    if(attachMenu) attachMenu.classList.add('hidden');
  };
}

document.addEventListener('click', (e) => {
  if(unifiedPicker &&!unifiedPicker.classList.contains('hidden')){
    const isPicker = unifiedPicker.contains(e.target);
    const isEmojiBtn = e.target.closest('#emoji-btn');
    const isAttachBtn = e.target.closest('#attach-btn');
    const isAttachMenu = e.target.closest('#attach-menu');
    if(!isPicker &&!isEmojiBtn &&!isAttachBtn &&!isAttachMenu){
      unifiedPicker.classList.add('hidden');
    }
  }
  if(attachMenu &&!attachMenu.classList.contains('hidden')){
    if(!attachMenu.contains(e.target) &&!e.target.closest('#attach-btn')){
      attachMenu.classList.add('hidden');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){
    if(unifiedPicker) unifiedPicker.classList.add('hidden');
    if(attachMenu) attachMenu.classList.add('hidden');
    const po = document.getElementById('profile-overlay');
    if(po) po.classList.add('hidden');
    const fp = document.getElementById('full-pic-overlay');
    if(fp) fp.classList.add('hidden');
    if(roomPassOverlay) roomPassOverlay.classList.add('hidden');
  }
});

if(chatMessages){
  chatMessages.addEventListener('click', () => {
    if(unifiedPicker) unifiedPicker.classList.add('hidden');
    if(attachMenu) attachMenu.classList.add('hidden');
  });
}

const replyPreview = document.getElementById('reply-preview');
const replyToName = document.getElementById('reply-to-name');
const replyToText = document.getElementById('reply-to-text');
const replyCancelBtn = document.getElementById('reply-cancel');

function setReply(id, senderName, text, fileUrl){
  pendingReply = { id, sender_name: senderName, text: text||"", file_url: fileUrl||"" };
  if(replyToName) replyToName.textContent = "Replying to " + senderName;
  if(replyToText) replyToText.textContent = text || (fileUrl? "📷 Photo" : "Message");
  if(replyPreview){ replyPreview.classList.remove('hidden'); replyPreview.style.display='flex'; }
  if(chatInput) chatInput.focus();
}
function clearReply(){
  pendingReply = null;
  if(replyPreview){ replyPreview.classList.add('hidden'); replyPreview.style.display='none'; }
}
if(replyCancelBtn) replyCancelBtn.onclick = clearReply;

if(usernameOverlay){
  usernameOverlay.addEventListener('click', (e) => {
    if(e.target.id === 'username-overlay'){
      if(currentUser){
        usernameOverlay.classList.add('hidden');
      } else {
        const box = usernameOverlay.querySelector('.password-box');
        if(box){
          box.style.animation = 'shake 0.3s';
          setTimeout(()=> box.style.animation = '', 300);
        }
      }
    }
  });
}
if(!document.getElementById('shake-style')){
  const style = document.createElement('style');
  style.id = 'shake-style';
  style.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}`;
  document.head.appendChild(style);
}