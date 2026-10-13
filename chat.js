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
let currentUser = localStorage.getItem('chat_username') || null;
let currentAvatar = localStorage.getItem('chat_avatar') || null;
let pendingRoom = null, pendingMode = null, realtimeChannel = null;
let pendingFile = null;

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
  const previewHTML = `
  <div id="file-preview-box" class="hidden" style="background:white; border-top:1px solid #ddd; padding:10px; display:flex; align-items:center; gap:10px; position:relative; display:none;">
    <img id="file-preview-img" src="" style="width:60px; height:60px; object-fit:cover; border-radius:8px; display:none;">
    <div id="file-preview-info" style="flex:1; overflow:hidden;">
      <p id="file-preview-name" style="font-size:13px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></p>
      <p id="file-preview-size" style="font-size:11px; color:#888;"></p>
    </div>
    <button id="file-preview-cancel" style="background:#eee; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:18px;">×</button>
  </div>`;
  bottomBar.insertAdjacentHTML('beforebegin', previewHTML);
  document.getElementById('file-preview-cancel').onclick = clearFilePreview;
}
createFilePreviewBox();

function showFilePreview(file) {
  pendingFile = file;
  const box = document.getElementById('file-preview-box');
  const img = document.getElementById('file-preview-img');
  const name = document.getElementById('file-preview-name');
  const size = document.getElementById('file-preview-size');
  name.textContent = file.name;
  size.textContent = (file.size/1024/1024).toFixed(2) + " MB • " + file.type;
  if(file.type.startsWith('image/')) {
    img.style.display = 'block';
    img.src = URL.createObjectURL(file);
  } else {
    img.style.display = 'none';
  }
  box.classList.remove('hidden');
  box.style.display = 'flex';
  chatInput.focus();
}

function clearFilePreview() {
  pendingFile = null;
  fileInput.value = "";
  const box = document.getElementById('file-preview-box');
  if(box) { box.classList.add('hidden'); box.style.display = 'none'; }
  document.getElementById('file-preview-img').src = "";
}

function createProfileOverlays() {
  if(document.getElementById('profile-overlay')) return;
  const profileHTML = `
  <div id="profile-overlay" class="password-overlay hidden" style="z-index:10000;">
    <div class="password-box" style="padding:0; overflow:hidden; max-width:340px;">
      <div style="background:#4a148c; padding:15px; color:white; display:flex; align-items:center; gap:10px;">
        <span id="profile-close" style="cursor:pointer; font-size:20px;">←</span><b>Profile</b>
      </div>
      <div style="text-align:center; padding:20px;">
        <img id="profile-full-img" src="" style="width:140px; height:140px; border-radius:50%; object-fit:cover; cursor:pointer; border:3px solid #eee;">
        <h3 id="profile-name" style="margin:12px 0 4px;">Name</h3>
        <p style="color:#666; font-size:13px;">Tap picture to view full</p>
        <div style="background:#f5f5f5; padding:10px; border-radius:8px; margin-top:15px; text-align:left;">
          <p style="font-size:12px; color:#888;">Room</p><p id="profile-room" style="font-size:14px; font-weight:bold;">general</p>
          <p style="font-size:12px; color:#888; margin-top:8px;">Username</p><p id="profile-username-detail" style="font-size:14px;">-</p>
        </div>
        <button id="profile-view-full" style="margin-top:15px; background:#4a148c; color:white; border:none; padding:10px; border-radius:8px; width:100%; cursor:pointer;">View Full Picture</button>
      </div>
    </div>
  </div>
  <div id="full-pic-overlay" class="password-overlay hidden" style="z-index:10001; background:rgba(0,0,0,0.9);">
    <span id="full-pic-close" style="position:absolute; top:20px; right:20px; color:white; font-size:30px; cursor:pointer;">×</span>
    <img id="full-pic-img" src="" style="max-width:90%; max-height:90%; border-radius:8px; object-fit:contain;">
  </div>`;
  document.body.insertAdjacentHTML('beforeend', profileHTML);
  document.getElementById('profile-close').onclick = () => document.getElementById('profile-overlay').classList.add('hidden');
  document.getElementById('profile-overlay').onclick = (e) => { if(e.target.id==='profile-overlay') e.currentTarget.classList.add('hidden'); };
  document.getElementById('full-pic-overlay').onclick = () => document.getElementById('full-pic-overlay').classList.add('hidden');
  document.getElementById('full-pic-close').onclick = () => document.getElementById('full-pic-overlay').classList.add('hidden');
  document.getElementById('profile-view-full').onclick = () => openFullImage(document.getElementById('profile-full-img').src);
  document.getElementById('profile-full-img').onclick = () => openFullImage(document.getElementById('profile-full-img').src);
}
createProfileOverlays();

function openProfile(senderName, avatarUrl) {
  document.getElementById('profile-name').textContent = senderName;
  document.getElementById('profile-username-detail').textContent = senderName;
  document.getElementById('profile-room').textContent = currentRoom;
  document.getElementById('profile-full-img').src = avatarUrl || `https://via.placeholder.com/300/4a148c/ffffff?text=${senderName.charAt(0).toUpperCase()}`;
  document.getElementById('profile-overlay').classList.remove('hidden');
}
function openFullImage(url) {
  if(!url) return;
  document.getElementById('full-pic-img').src = url;
  document.getElementById('full-pic-overlay').classList.remove('hidden');
}

if(currentAvatar && avatarPreview) avatarPreview.src = currentAvatar;
function formatTime(d){
  const date=new Date(d);
  const diff=Math.floor((new Date()-date)/86400000);
  let dp=diff===0?"Today":diff===1?"Yesterday":date.toLocaleDateString([],{day:'2-digit',month:'short'});
  return `${dp} • ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}
if(avatarInput){
  avatarInput.addEventListener('change', ()=>{
    const file = avatarInput.files[0]; if(!file) return;
    avatarPreview.src = URL.createObjectURL(file);
  });
}
if(!currentUser){ usernameOverlay.classList.remove('hidden'); } else { usernameOverlay.classList.add('hidden'); loadMessages(); connectToRealtimeStream(); }

usernameBtn.addEventListener('click', async ()=>{
  const name = usernameInput.value.trim(); if(!name) return alert("Enter your name");
  usernameBtn.textContent = "Saving..."; usernameBtn.disabled = true;
  let avatarUrl = currentAvatar;
  try{
    const file = avatarInput && avatarInput.files[0];
    if(file){
      const fileName = `${name}_${Date.now()}_${file.name}`;
      const { error } = await supabaseClient.storage.from('avatars').upload(fileName, file);
      if(error) throw error;
      const { data } = supabaseClient.storage.from('avatars').getPublicUrl(fileName);
      avatarUrl = data.publicUrl;
    }
    currentUser = name; currentAvatar = avatarUrl;
    localStorage.setItem('chat_username', name);
    if(avatarUrl) localStorage.setItem('chat_avatar', avatarUrl);
    if(avatarUrl){ await supabaseClient.from('user_profiles').upsert([{username: name, avatar_url: avatarUrl}]); }
    usernameOverlay.classList.add('hidden'); loadMessages(); connectToRealtimeStream();
  }catch(err){ alert("Error: " + err.message); }finally{ usernameBtn.textContent = "Continue"; usernameBtn.disabled = false; }
});

async function loadMessages(){
  const { data } = await supabaseClient.from('messages').select('*').eq('room_id', currentRoom).order('created_at',{ascending:true});
  chatMessages.innerHTML=""; if(data) data.forEach(m=> appendMessageToFeed(m.text, m.file_url, m.file_type, m.sender_name, m.avatar_url, m.sender_name===currentUser, m.created_at, m.id));
  currentRoomLabel.textContent=`Room: ${currentRoom} | You: ${currentUser||'Guest'}`;
}

function appendMessageToFeed(text, fileUrl, fileType, senderName, avatarUrl, isOwn=false, createdAt=null, messageId=null){
  const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.alignItems='flex-end'; row.style.maxWidth='75%'; row.style.alignSelf = isOwn? 'flex-end' : 'flex-start'; if(isOwn) row.style.marginLeft='auto';
  let avatarEl;
  if(avatarUrl){ avatarEl = document.createElement('img'); avatarEl.src = avatarUrl; avatarEl.style.width='32px'; avatarEl.style.height='32px'; avatarEl.style.borderRadius='50%'; avatarEl.style.objectFit='cover'; avatarEl.style.flexShrink='0'; avatarEl.style.cursor='pointer'; }
  else { avatarEl = document.createElement('div'); avatarEl.textContent = (senderName||'?').charAt(0).toUpperCase(); avatarEl.style.width='32px'; avatarEl.style.height='32px'; avatarEl.style.borderRadius='50%'; avatarEl.style.background='#4a148c'; avatarEl.style.color='white'; avatarEl.style.display='flex'; avatarEl.style.alignItems='center'; avatarEl.style.justifyContent='center'; avatarEl.style.fontWeight='bold'; avatarEl.style.flexShrink='0'; avatarEl.style.cursor='pointer'; }
  avatarEl.onclick = () => openProfile(senderName, avatarUrl);
  const bubble=document.createElement('div'); bubble.classList.add('message', isOwn?'outgoing':'incoming'); if(messageId) bubble.setAttribute('data-id', messageId);
  if(!isOwn && senderName){ const nameEl=document.createElement('b'); nameEl.textContent=senderName; nameEl.style.fontSize='12px'; nameEl.style.color='#075e54'; nameEl.style.display='block'; nameEl.style.marginBottom='2px'; nameEl.style.cursor='pointer'; nameEl.onclick = () => openProfile(senderName, avatarUrl); bubble.appendChild(nameEl); }
  if(text){ const s=document.createElement('div'); s.textContent=text; s.style.whiteSpace='pre-wrap'; s.style.wordBreak='break-word'; bubble.appendChild(s); }
    if(fileUrl){
    if(fileType?.startsWith('image/')){
      const img=document.createElement('img');
      img.src=fileUrl;
      img.style.maxWidth='200px';
      img.style.borderRadius='8px';
      img.style.marginTop='5px';
      img.style.cursor='pointer';
      img.onclick = () => openFullImage(fileUrl);
      bubble.appendChild(img);
    }
    else if(fileType?.startsWith('audio/')){
      const audio=document.createElement('audio');
      audio.src=fileUrl;
      audio.controls=true;
      audio.preload='metadata';
      audio.style.maxWidth='220px';
      audio.style.marginTop='6px';
      audio.style.display='block';
      bubble.appendChild(audio);
    }
    else {
      const a=document.createElement('a');
      a.href=fileUrl;
      a.target='_blank';
      a.textContent='📄 '+(text||'View File');
      bubble.appendChild(a);
    }
  }
  const meta = document.createElement('div'); meta.style.display='flex'; meta.style.justifyContent='flex-end'; meta.style.alignItems='center'; meta.style.gap='8px'; meta.style.marginTop='4px';
  const timeSpan=document.createElement('span'); timeSpan.classList.add('chat-timestamp'); timeSpan.textContent=formatTime(createdAt||new Date()); meta.appendChild(timeSpan);
  if(isOwn && messageId){ const deleteBtn = document.createElement('span'); deleteBtn.classList.add('delete-btn'); deleteBtn.textContent = '× Delete'; deleteBtn.addEventListener('click', async () => { if(confirm("Delete this message?")){ const { error } = await supabaseClient.from('messages').delete().eq('id', messageId); if(error) alert("Error: " + error.message); } }); meta.appendChild(deleteBtn); }
  bubble.appendChild(meta);
  if(!isOwn){ row.appendChild(avatarEl); row.appendChild(bubble); } else { row.appendChild(bubble); row.appendChild(avatarEl); }
  chatMessages.appendChild(row); chatMessages.scrollTop=chatMessages.scrollHeight;
}

async function sendMessage(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); return alert("Set your name first"); }
  if(pendingFile) {
    const file = pendingFile;
    const caption = chatInput.value.trim() || file.name;
    sendBtn.textContent="..."; sendBtn.disabled=true;
    try{
      const fileName=`${currentRoom}/${Date.now()}_${file.name}`;
      const { error }=await supabaseClient.storage.from('chat-files').upload(fileName,file);
      if(error) throw error;
      const { data }=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
      await supabaseClient.from('messages').insert([{ text: caption, room_id: currentRoom, file_url: data.publicUrl, file_type: file.type, sender_name: currentUser, avatar_url: currentAvatar }]);
      clearFilePreview(); chatInput.value="";
    }catch(err){ alert(err.message); }
    sendBtn.textContent="Send"; sendBtn.disabled=false;
    return;
  }
  const text=chatInput.value.trim(); if(!text) return;
  chatInput.value="";
  await supabaseClient.from('messages').insert([{ text, room_id: currentRoom, sender_name: currentUser, avatar_url: currentAvatar }]);
}

async function attemptJoinRoom(){
  if(!currentUser){ usernameOverlay.classList.remove('hidden'); return alert("Enter your name first"); }
  const name=roomInput.value.trim(); if(!name) return alert("Enter room name");
  pendingRoom=name;
  const { data } = await supabaseClient.from('rooms').select('*').eq('id',name).maybeSingle();
  if(!data){ pendingMode='create'; roomPassTitle.textContent='Create Password'; roomPassDesc.textContent=`"${name}" is new. Set password`; }
  else { pendingMode='join'; roomPassTitle.textContent='Enter Password'; roomPassDesc.textContent=`"${name}" is private`; }
  roomPassInput.value=""; roomPassError.textContent=""; roomPassOverlay.classList.remove('hidden');
}

async function confirmRoomPassword(){
  const pass=roomPassInput.value.trim(); if(!pass){ roomPassError.textContent="Enter password"; return; }
  roomPassBtn.textContent="Checking..."; roomPassBtn.disabled=true;
  if(pendingMode==='create'){
    const { error }=await supabaseClient.from('rooms').insert([{id:pendingRoom,password:pass}]);
    if(error){ roomPassError.textContent=error.message; roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; return; }
  } else {
    const { data }=await supabaseClient.from('rooms').select('*').eq('id',pendingRoom).eq('password',pass).maybeSingle();
    if(!data){ roomPassError.textContent="Wrong password!"; roomPassBtn.textContent="Join"; roomPassBtn.disabled=false; return; }
  }
  currentRoom=pendingRoom; localStorage.setItem('last_room', currentRoom); saveJoinedRoom(currentRoom);
  roomPassOverlay.classList.add('hidden'); roomPassBtn.textContent="Join Room"; roomPassBtn.disabled=false; loadMessages(); connectToRealtimeStream();
}

function connectToRealtimeStream(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel(`chat-${currentRoom}-${Date.now()}`)
.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>{
      if(p.new.room_id!==currentRoom) return;
      appendMessageToFeed(p.new.text, p.new.file_url, p.new.file_type, p.new.sender_name, p.new.avatar_url, p.new.sender_name===currentUser, p.new.created_at, p.new.id);
    })
.on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{
      const el = chatMessages.querySelector(`[data-id="${p.old.id}"]`); if(el) el.parentElement.remove();
    })
.subscribe();
}

joinBtn.addEventListener('click',attemptJoinRoom);
roomPassBtn.addEventListener('click',confirmRoomPassword);
roomPassClose.addEventListener('click',()=>roomPassOverlay.classList.add('hidden'));
sendBtn.addEventListener('click',sendMessage);
chatInput.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});

fileInput.addEventListener('change', ()=>{
  const file=fileInput.files[0]; if(!file) return;
  showFilePreview(file);
});
// --- VOICE NOTE LOGIC (IMPROVED - iPhone + Android + no redirect) ---
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let audioStream = null;

const micBtn = document.getElementById('mic-btn');
const recordingPreview = document.getElementById('recording-preview');
const recordingTime = document.getElementById('recording-time');
const recordingCancel = document.getElementById('recording-cancel');
const recordingStop = document.getElementById('recording-stop');

function formatRecTime(s) {
  const m = String(Math.floor(s/60)).padStart(2,'0');
  const sec = String(s%60).padStart(2,'0');
  return `${m}:${sec}`;
}

function getSupportedMime() {
  // iPhone Safari needs mp4/aac, Chrome/Firefox uses webm
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return 'audio/webm';
}

async function startRecording() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getSupportedMime();
    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    audioChunks = [];
    recordingSeconds = 0;

    mediaRecorder.ondataavailable = e => {
      if(e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      clearInterval(recordingTimer);
      if(audioChunks.length === 0) return;
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      if(audioBlob.size < 800) { // too short, ignore
        clearFilePreview();
        return;
      }
      const ext = mimeType.includes('mp4')? 'm4a' : 'webm';
      const file = new File([audioBlob], `voicenote_${Date.now()}.${ext}`, { type: mimeType });
      showFilePreview(file);
    };

    mediaRecorder.start(100); // collect every 100ms
    if(micBtn) micBtn.classList.add('recording');
    if(recordingPreview) {
      recordingPreview.classList.remove('hidden');
      recordingPreview.style.display = 'flex';
    }
    if(recordingTime) recordingTime.textContent = '00:00';
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      if(recordingTime) recordingTime.textContent = formatRecTime(recordingSeconds);
    }, 1000);

  } catch(err) {
    alert("Mic permission denied: " + err.message);
    stopRecording(true);
  }
}

function stopRecording(cancel = false) {
  try {
    if(mediaRecorder && mediaRecorder.state!== 'inactive') {
      if(cancel) {
        audioChunks = [];
        mediaRecorder.onstop = null; // don't create file
      }
      mediaRecorder.stop();
    }
  } catch(e) {}
  if(audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
  clearInterval(recordingTimer);
  if(micBtn) micBtn.classList.remove('recording');
  if(recordingPreview) {
    recordingPreview.classList.add('hidden');
    recordingPreview.style.display = 'none';
  }
  if(cancel) clearFilePreview();
}

if(micBtn){
  micBtn.onclick = () => {
    if(micBtn.classList.contains('recording')) {
      stopRecording(false); // second tap = send
    } else {
      startRecording();
    }
  };
}
if(recordingStop) recordingStop.onclick = () => stopRecording(false);
if(recordingCancel) recordingCancel.onclick = () => stopRecording(true);

if(togglePass) togglePass.addEventListener('click',()=>{
  roomPassInput.type = roomPassInput.type==='password'?'text':'password';
  togglePass.textContent = roomPassInput.type==='password'?'👁️':'🙈';
});

function renderCommunitiesList() {
  let container = document.getElementById('communities-list');
  if(!container) {
    const box = usernameOverlay.querySelector('.password-box'); if(!box) return; if(document.getElementById('communities-wrapper')) return;
    const wrapper = document.createElement('div'); wrapper.id = 'communities-wrapper';
    wrapper.innerHTML = `<hr style="margin:12px 0; border:none; border-top:1px solid #eee;"><p style="text-align:left; font-weight:bold; font-size:13px; margin-bottom:8px;">List of Communities</p><div id="communities-list" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; text-align:left;"></div>`;
    box.appendChild(wrapper); container = document.getElementById('communities-list');
  }
  const rooms = getJoinedRooms();
  if(rooms.length === 0) { container.innerHTML = `<p style="font-size:12px; color:#888;">No communities yet. Join a room!</p>`; return; }
  container.innerHTML = "";
  rooms.forEach(r => {
    const item = document.createElement('div'); item.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#f5f0ff; padding:8px 10px; border-radius:8px; cursor:pointer;";
    item.innerHTML = `<span style="font-size:13px; font-weight:600;"># ${r}</span><span style="font-size:11px; color:#4a148c;">Tap to join</span>`;
    item.onclick = async () => {
      currentRoom = r; localStorage.setItem('last_room', r); usernameOverlay.classList.add('hidden'); pendingRoom = r;
      const { data } = await supabaseClient.from('rooms').select('*').eq('id',r).maybeSingle();
      if(!data) { alert("Room no longer exists"); return; }
      pendingMode='join'; roomPassTitle.textContent='Enter Password'; roomPassDesc.textContent=`"${r}" is private`; roomPassInput.value=""; roomPassError.textContent=""; roomPassOverlay.classList.remove('hidden');
    };
    container.appendChild(item);
  });
}

const changeProfileBtn = document.getElementById('change-profile-btn');
if(changeProfileBtn){
  changeProfileBtn.addEventListener('click', ()=>{
    usernameOverlay.classList.remove('hidden');
    usernameInput.value = currentUser || "";
    if(currentAvatar) avatarPreview.src = currentAvatar;
    setTimeout(renderCommunitiesList, 80);
  });
}

window.addEventListener('DOMContentLoaded', () => { chatInput.value = ""; if(roomInput) roomInput.value = ""; });
chatInput.value = ""; if(roomInput) roomInput.value = "";