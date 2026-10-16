const SUPABASE_URL = "https://fmhfknlhyriiahywdcdc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_665mBiTJNWgKdZ3hTZVH5w_5tidUFTO";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = localStorage.getItem('fed_name');
let currentAvatar = localStorage.getItem('chat_avatar');
let currentUserId = null;
let targetId = new URLSearchParams(window.location.search).get('to') || localStorage.getItem('dm_target_id');
let targetName = new URLSearchParams(window.location.search).get('name') || localStorage.getItem('dm_target_name') || 'User';
let targetAvatar = localStorage.getItem('dm_target_avatar') || '';
let roomId = new URLSearchParams(window.location.search).get('room');
let pendingReply = null, pendingFile = null, realtimeChannel = null;
let callChannel = null, presenceChannel = null, pc = null, localStream = null;
let callType = 'video';
let mediaRecorder = null, audioChunks = [], isRecording = false;

document.getElementById('target-name').textContent = decodeURIComponent(targetName);
document.getElementById('call-with-name').textContent = decodeURIComponent(targetName);
if(targetAvatar){
  document.getElementById('target-avatar').src = targetAvatar;
  document.getElementById('incoming-avatar').src = targetAvatar;
} else {
  let ph=`https://via.placeholder.com/40/4a148c/fff?text=${encodeURIComponent(targetName.charAt(0))}`;
  document.getElementById('target-avatar').src = ph;
  document.getElementById('incoming-avatar').src = ph;
}

async function ensureAuth(){
  let {data:{session}} = await supabaseClient.auth.getSession();
  if(!session){ const {data}= await supabaseClient.auth.signInAnonymously(); session=data.session; }
  currentUserId = session.user.id;
  if(!roomId){ const ids=[currentUserId,targetId].sort(); roomId=`dm_${ids[0]}_${ids[1]}`.substring(0,60); }
  loadPrivateMessages(); connectRealtime(); connectCallAndPresence(); checkPermission();
}
function goBack(){ window.location.href='index.html'; }
function formatTime(d){ const date=new Date(d); return date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }

// ===== PERMISSION =====
async function checkPermission(){
  const {data} = await supabaseClient.from('private_requests').select('*').or(`and(from_id.eq.${currentUserId},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${currentUserId})`).maybeSingle();
  const btn=document.getElementById('perm-btn');
  if(!data){ btn.textContent='Request'; btn.style.background='#ff9800'; btn.onclick=requestPermission; }
  else if(data.status==='pending' && data.from_id===currentUserId){ btn.textContent='Pending'; btn.style.background='#888'; btn.disabled=true; }
  else if(data.status==='pending' && data.to_id===currentUserId){ btn.textContent='Accept'; btn.style.background='#00c853'; btn.onclick=()=>acceptRequest(data.id); }
  else if(data.status==='accepted'){ btn.textContent='✓ Connected'; btn.style.background='#00c853'; btn.disabled=true; document.getElementById('chat-input').disabled=false; }
}
async function requestPermission(){
  const {error}=await supabaseClient.from('private_requests').insert([{from_id:currentUserId,from_name:currentUser,from_avatar:currentAvatar,to_id:targetId,to_name:targetName,status:'pending'}]);
  if(error) alert(error.message); else { alert('Request sent'); checkPermission(); }
}
async function acceptRequest(id){ await supabaseClient.from('private_requests').update({status:'accepted'}).eq('id',id); checkPermission(); }

async function loadPrivateMessages(){
  const {data}=await supabaseClient.rpc('get_messages_secure',{room_name:roomId,pass_hash:''});
  const box=document.getElementById('chat-messages'); box.innerHTML=''; (data||[]).forEach(appendMessage);
}

// ===== AVATAR + V MENU + PROFILE POPUP =====
function showProfileInfo(name, avatar, id){
  let existing = document.getElementById('profile-popup');
  if(existing) existing.remove();
  let div = document.createElement('div');
  div.id = 'profile-popup';
  div.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999`;
  div.innerHTML = `
    <div style="background:white;padding:20px;border-radius:16px;text-align:center;min-width:260px;max-width:90%">
      <img src="${avatar || `https://via.placeholder.com/80/4a148c/fff?text=${encodeURIComponent(name.charAt(0))}`}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin-bottom:10px">
      <h3 style="margin:0">${name}</h3>
      <p style="font-size:13px;margin-top:8px;color:#555">${id===currentUserId?'You':(id===targetId?'Private chat with '+name:name)}</p>
      <button onclick="document.getElementById('profile-popup').remove()" style="margin-top:12px;padding:8px 16px;background:#4a148c;color:white;border:none;border-radius:8px;cursor:pointer">Close</button>
    </div>`;
  div.onclick = (e)=>{ if(e.target===div) div.remove(); };
  document.body.appendChild(div);
}

function appendMessage(m){
  const box=document.getElementById('chat-messages');
  const isOwn=m.sender_id===currentUserId;
  const row=document.createElement('div');
  row.style.cssText=`display:flex;gap:8px;max-width:85%;align-self:${isOwn?'flex-end':'flex-start'};${isOwn?'margin-left:auto;flex-direction:row-reverse':''};position:relative;margin-bottom:8px`;

  // PIC ICON
  const avatarImg = document.createElement('img');
  avatarImg.src = m.avatar_url || `https://via.placeholder.com/32/4a148c/fff?text=${(m.sender_name||'U').charAt(0)}`;
  avatarImg.style.cssText='width:32px;height:32px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;align-self:flex-end';
  avatarImg.onclick = ()=> showProfileInfo(m.sender_name, m.avatar_url, m.sender_id);

  const bubbleWrap = document.createElement('div');
  bubbleWrap.style.cssText='position:relative;max-width:calc(100% - 40px)';

  const bubble=document.createElement('div');
  bubble.style.cssText=`background:${isOwn?'#e8dafa':'white'};padding:8px 12px;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.1);position:relative;`;

  // small V button
  const vBtn = document.createElement('span');
  vBtn.textContent='⌄';
  vBtn.style.cssText=`position:absolute;top:2px;${isOwn?'left:6px':'right:6px'};font-size:14px;color:#888;cursor:pointer;padding:0 4px;display:none`;
  bubble.appendChild(vBtn);

  // popup menu
  const menu = document.createElement('div');
  menu.style.cssText='position:absolute;top:20px;right:0;background:white;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.2);z-index:10;display:none;min-width:110px;overflow:hidden';
  if(isOwn){
    menu.innerHTML=`<div class="menu-item" data-act="reply">↩ Reply</div><div class="menu-item" data-act="edit">✏️ Edit</div><div class="menu-item" data-act="delete" style="color:red">🗑 Delete</div>`;
  } else {
    menu.innerHTML=`<div class="menu-item" data-act="reply">↩ Reply</div><div class="menu-item" data-act="info">👤 Info</div>`;
  }
  menu.querySelectorAll('.menu-item').forEach(el=>{
    el.style.cssText='padding:8px 12px;font-size:13px;cursor:pointer';
    el.onmouseenter=()=>el.style.background='#f0f0f0';
    el.onmouseleave=()=>el.style.background='white';
  });
  bubble.appendChild(menu);

  bubble.onmouseenter=()=> vBtn.style.display='block';
  bubble.onmouseleave=()=>{ if(menu.style.display!=='block') vBtn.style.display='none'; };
  vBtn.onclick=(e)=>{ e.stopPropagation(); menu.style.display = menu.style.display==='block'?'none':'block'; };
  document.addEventListener('click',()=>{ menu.style.display='none'; vBtn.style.display='none'; });

  menu.onclick = async (e)=>{
    const act = e.target.dataset.act;
    if(act==='reply'){ setReply(m.id,m.sender_name,m.text||''); }
    else if(act==='edit' && isOwn){
      let newText = prompt('Edit message:', m.text);
      if(newText!==null){ await supabaseClient.from('messages').update({text:newText}).eq('id',m.id); m.text=newText; box.innerHTML=''; loadPrivateMessages(); }
    }
    else if(act==='delete' && isOwn){
      if(confirm('Delete message?')){ await supabaseClient.from('messages').delete().eq('id',m.id); row.remove(); }
    }
    else if(act==='info'){ showProfileInfo(m.sender_name,m.avatar_url,m.sender_id); }
    menu.style.display='none';
  };

  if(m.reply_to_name){
    const q=document.createElement('div');
    q.style.cssText='border-left:3px solid #4a148c;background:rgba(0,0,0,0.06);padding:4px 6px;margin-bottom:4px;border-radius:4px;font-size:11px;';
    q.innerHTML=`<b>${m.reply_to_name}</b><br>${m.reply_to_text||''}`;
    bubble.appendChild(q);
  }
  if(m.text){ const t=document.createElement('div'); t.textContent=m.text; t.style.fontSize='14px'; bubble.appendChild(t); }
  if(m.file_url){
    if(m.file_type?.startsWith('image/')){ const img=document.createElement('img'); img.src=m.file_url; img.style.maxWidth='200px'; img.style.borderRadius='10px'; img.style.marginTop='4px'; bubble.appendChild(img); }
    else if(m.file_type?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=m.file_url; a.controls=true; a.style.maxWidth='200px'; bubble.appendChild(a); }
    else { const a=document.createElement('a'); a.href=m.file_url; a.textContent='📎 '+ (m.text||'File'); a.target='_blank'; bubble.appendChild(a); }
  }
  const meta=document.createElement('div');
  meta.style.cssText='font-size:10px;color:#888;text-align:right;margin-top:4px;';
  meta.textContent=formatTime(m.created_at);
  bubble.appendChild(meta);

  bubbleWrap.appendChild(bubble);
  row.appendChild(avatarImg);
  row.appendChild(bubbleWrap);
  box.appendChild(row);
  box.scrollTop=box.scrollHeight;
}

function setReply(id,name,text){ pendingReply={id,name,text:text.substring(0,80)}; document.getElementById('reply-to-name').textContent='Replying to '+name; document.getElementById('reply-to-text').textContent=text; document.getElementById('reply-preview').classList.remove('hidden'); document.getElementById('reply-preview').style.display='flex'; }
document.getElementById('reply-cancel').onclick=()=>{ pendingReply=null; document.getElementById('reply-preview').style.display='none'; };

// ===== SEND =====
async function sendMessage(){
  const input=document.getElementById('chat-input'); let text=input.value.trim(); if(!text &&!pendingFile) return;
  const {data} = await supabaseClient.from('private_requests').select('*').or(`and(from_id.eq.${currentUserId},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${currentUserId})`).eq('status','accepted').maybeSingle();
  if(!data){ alert('Request access first'); return; }
  let payload = {text:text||pendingFile?.name||'', room_id:roomId,sender_name:currentUser,avatar_url:currentAvatar,sender_id:currentUserId,reply_to_name:pendingReply?.name||null,reply_to_text:pendingReply?.text||null};
  if(pendingFile){
    const file=pendingFile; const fileName=`${roomId}/${currentUserId}_${Date.now()}_${file.name}`;
    const {error}=await supabaseClient.storage.from('chat-files').upload(fileName,file); if(error){ alert(error.message); return; }
    const {data:pub}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
    payload.file_url=pub.publicUrl; payload.file_type=file.type;
    pendingFile=null; document.getElementById('file-name-preview')?.classList.add('hidden');
  }
  await supabaseClient.from('messages').insert([payload]);
  input.value=''; pendingReply=null; document.getElementById('reply-preview').style.display='none';
}

function connectRealtime(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel(`private-${roomId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${roomId}`},p=>appendMessage(p.new)).subscribe();
}

// ===== VOICE NOTE RECORDING =====
let recordingBlob = null;
let recTimerInterval = null;
let recSeconds = 0;

function setupVoiceNote(){
  const voiceBtn = document.getElementById('voice-btn');
  const chatInput = document.getElementById('chat-input');
  const recordingUI = document.getElementById('recording-ui');
  const recTimer = document.getElementById('rec-timer');
  const cancelRec = document.getElementById('cancel-rec');

  if(!voiceBtn) return;

  async function startRecording(){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      audioChunks=[];
      mediaRecorder=new MediaRecorder(stream, {mimeType: 'audio/webm'});
      mediaRecorder.ondataavailable = ev=> { if(ev.data.size>0) audioChunks.push(ev.data); };
      mediaRecorder.onstop = ()=>{
        recordingBlob = new Blob(audioChunks,{type:'audio/webm'});
        stream.getTracks().forEach(t=>t.stop());
      };
      mediaRecorder.start();
      isRecording = true;
      recSeconds = 0;

      chatInput.classList.add('hidden');
      if(recordingUI) recordingUI.classList.remove('hidden');
      voiceBtn.textContent='⏹';
      voiceBtn.classList.add('recording');
      voiceBtn.style.background='#ff1744';
      voiceBtn.style.color='white';

      recTimerInterval = setInterval(()=>{
        recSeconds++;
        const m = Math.floor(recSeconds/60);
        const s = recSeconds%60;
        if(recTimer) recTimer.textContent = `● ${m}:${s.toString().padStart(2,'0')}`;
      },1000);

    }catch(err){ alert('Mic permission needed: '+err.message); }
  }

  function stopRecordingAndKeep(){
    if(mediaRecorder && mediaRecorder.state==='recording'){
      mediaRecorder.stop();
    }
    isRecording = false;
    clearInterval(recTimerInterval);
    if(recTimer) recTimer.textContent = `● Ready ${Math.floor(recSeconds/60)}:${(recSeconds%60).toString().padStart(2,'0')} - Press Send`;
  }

  function cancelRecording(){
    if(mediaRecorder && mediaRecorder.state==='recording') mediaRecorder.stop();
    isRecording = false;
    recordingBlob = null;
    audioChunks = [];
    clearInterval(recTimerInterval);
    chatInput.classList.remove('hidden');
    if(recordingUI) recordingUI.classList.add('hidden');
    voiceBtn.textContent='🎤';
    voiceBtn.classList.remove('recording');
    voiceBtn.style.background='white';
    voiceBtn.style.color='black';
    chatInput.placeholder='Type a private message...';
  }

  voiceBtn.onclick = ()=>{
    if(!isRecording &&!recordingBlob){
      startRecording();
    } else if(isRecording){
      stopRecordingAndKeep();
    } else {
      cancelRecording();
      startRecording();
    }
  };

  if(cancelRec) cancelRec.onclick = cancelRecording;

  // Make send handle voice
  const originalSend = window.sendMessage || sendMessage;

  window.sendMessage = async function(){
    if(recordingBlob || isRecording){
      if(isRecording){
        stopRecordingAndKeep();
        await new Promise(r=>setTimeout(r,300));
      }
      if(!recordingBlob || recordingBlob.size < 1000){
        cancelRecording();
        return;
      }
      const fileName=`${roomId}/${currentUserId}_${Date.now()}_voice.webm`;
      const {error} = await supabaseClient.storage.from('chat-files').upload(fileName, recordingBlob);
      if(error){ alert('Voice upload failed: '+error.message); cancelRecording(); return; }
      const {data:pub}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
      await supabaseClient.from('messages').insert([{
        room_id:roomId,sender_name:currentUser,avatar_url:currentAvatar,sender_id:currentUserId,
        file_url:pub.publicUrl,file_type:'audio/webm',text:'🎤 Voice note'
      }]);
      cancelRecording();
      return;
    }
    originalSend();
  };
}

// ===== CALL + PRESENCE (ONLINE) =====
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let incomingOffer = null;

function connectCallAndPresence(){
  if(callChannel) supabaseClient.removeChannel(callChannel);
  callChannel = supabaseClient.channel(`call-${roomId}`);
  callChannel.on('broadcast', { event: 'call-offer' }, async (payload)=>{
    if(payload.payload.to!== currentUserId) return;
    if(payload.payload.type === 'offer'){ incomingOffer = payload.payload; showIncomingCall(payload.payload.callType); }
    else if(payload.payload.type === 'answer'){ if(pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.payload.sdp)); }
    else if(payload.payload.type === 'ice'){ if(pc) try{ await pc.addIceCandidate(payload.payload.candidate); }catch(e){} }
    else if(payload.payload.type === 'end'){ endCall(false); }
  }).subscribe();

  // ONLINE PRESENCE
  if(presenceChannel) supabaseClient.removeChannel(presenceChannel);
  presenceChannel = supabaseClient.channel(`presence-private-${roomId}`, { config: { presence: { key: currentUserId } } });
  presenceChannel.on('presence', { event: 'sync' }, ()=>{
    const state = presenceChannel.presenceState();
    const users=[]; for(const id in state){ state[id].forEach(p=> users.push(p)); }
    const isTargetOnline = users.some(u=> u.id === targetId);
    const statusEl = document.getElementById('target-status');
    if(statusEl){
      if(isTargetOnline){ statusEl.textContent='● Online'; statusEl.style.color='#00ff88'; }
      else { statusEl.textContent='○ Offline'; statusEl.style.color='rgba(255,255,255,0.7)'; }
    }
  });
  presenceChannel.subscribe(async (status)=>{
    if(status==='SUBSCRIBED'){ await presenceChannel.track({ id: currentUserId, name: currentUser }); }
  });
}

async function createPeerConnection(){
  pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (e)=>{ if(e.candidate){ callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'ice', candidate:e.candidate } }); } };
  pc.ontrack = (e)=>{ document.getElementById('remote-video').srcObject = e.streams[0]; };
  if(localStream){ localStream.getTracks().forEach(track=> pc.addTrack(track, localStream)); }
  return pc;
}
async function startCall(type){
  callType=type;
  const {data} = await supabaseClient.from('private_requests').select('*').or(`and(from_id.eq.${currentUserId},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${currentUserId})`).eq('status','accepted').maybeSingle();
  if(!data){ alert('You need to be connected first'); return; }
  try{ localStream = await navigator.mediaDevices.getUserMedia({ video: type==='video', audio:true }); }catch(e){ alert('Mic/Camera permission needed'); return; }
  document.getElementById('local-video').srcObject=localStream; document.getElementById('call-overlay').style.display='flex';
  document.getElementById('call-status-text').textContent=type==='video'?'Video calling...':'Voice calling...';
  document.getElementById('local-video').style.display=type==='video'?'block':'none';
  await createPeerConnection(); const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'offer', sdp:offer, callType:type, from_name:currentUser, from_avatar:currentAvatar } });
}
function showIncomingCall(type){
  document.getElementById('incoming-call').style.display='block';
  document.getElementById('incoming-name').textContent=targetName+' is calling...';
  document.getElementById('incoming-type').textContent=type==='video'?'Video call':'Voice call';
}
async function acceptIncomingCall(){
  const offer=incomingOffer; document.getElementById('incoming-call').style.display='none'; callType=offer.callType;
  try{ localStream=await navigator.mediaDevices.getUserMedia({ video: callType==='video', audio:true }); }catch(e){ alert('Permission needed'); return; }
  document.getElementById('local-video').srcObject=localStream; document.getElementById('call-overlay').style.display='flex';
  document.getElementById('call-status-text').textContent='Connected'; document.getElementById('local-video').style.display=callType==='video'?'block':'none';
  await createPeerConnection(); await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
  const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
  callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: offer.from, from: currentUserId, type:'answer', sdp:answer } });
}
function endCall(notify=true){
  if(notify && callChannel){ callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'end' } }); }
  document.getElementById('call-overlay').style.display='none'; document.getElementById('incoming-call').style.display='none';
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; } if(pc){ pc.close(); pc=null; }
  document.getElementById('remote-video').srcObject=null; document.getElementById('local-video').srcObject=null; incomingOffer=null;
}

document.getElementById('voice-call-btn').onclick=()=> startCall('voice');
document.getElementById('video-call-btn').onclick=()=> startCall('video');
document.getElementById('accept-call').onclick=acceptIncomingCall;
document.getElementById('decline-call').onclick=()=>{ document.getElementById('incoming-call').style.display='none'; if(incomingOffer) callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: incomingOffer.from, from: currentUserId, type:'end' } }); incomingOffer=null; };
document.getElementById('end-call-btn').onclick=()=> endCall(true);
document.getElementById('mute-btn').onclick=(e)=>{ if(!localStream) return; const track=localStream.getAudioTracks()[0]; if(track){ track.enabled=!track.enabled; e.currentTarget.textContent=track.enabled?'🔇':'🔈'; } };
document.getElementById('toggle-video-btn').onclick=(e)=>{ if(!localStream) return; const track=localStream.getVideoTracks()[0]; if(track){ track.enabled=!track.enabled; e.currentTarget.textContent=track.enabled?'🎥':'🚫'; } };

document.getElementById('send-btn').onclick=sendMessage;
document.getElementById('chat-input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); } });
document.getElementById('attach-btn').onclick=()=>document.getElementById('file-input').click();
document.getElementById('file-input').addEventListener('change',e=>{ pendingFile=e.target.files[0]; });

ensureAuth();
setupVoiceNote();