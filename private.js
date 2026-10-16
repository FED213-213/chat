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
let callChannel = null, pc = null, localStream = null, remoteStream = null, callType = 'video';

document.getElementById('target-name').textContent = decodeURIComponent(targetName);
document.getElementById('call-with-name').textContent = decodeURIComponent(targetName);
if(targetAvatar){ document.getElementById('target-avatar').src = targetAvatar; document.getElementById('incoming-avatar').src = targetAvatar; }
else {
  let ph=`https://via.placeholder.com/40/4a148c/fff?text=${encodeURIComponent(targetName.charAt(0))}`;
  document.getElementById('target-avatar').src = ph; document.getElementById('incoming-avatar').src = ph;
}

async function ensureAuth(){
  let {data:{session}} = await supabaseClient.auth.getSession();
  if(!session){ const {data}= await supabaseClient.auth.signInAnonymously(); session=data.session; }
  currentUserId = session.user.id;
  if(!roomId){ const ids=[currentUserId,targetId].sort(); roomId=`dm_${ids[0]}_${ids[1]}`.substring(0,60); }
  loadPrivateMessages(); connectRealtime(); connectCallChannel(); checkPermission();
}
function goBack(){ window.location.href='index.html'; }
function formatTime(d){ const date=new Date(d); return date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }

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
function appendMessage(m){
  const box=document.getElementById('chat-messages'); const isOwn=m.sender_id===currentUserId;
  const row=document.createElement('div'); row.style.cssText=`display:flex;gap:8px;max-width:78%;align-self:${isOwn?'flex-end':'flex-start'};${isOwn?'margin-left:auto':''}`;
  const bubble=document.createElement('div'); bubble.style.cssText=`background:${isOwn?'#e8dafa':'white'};padding:8px 12px;border-radius:12px;`;
  if(m.reply_to_name){ const q=document.createElement('div'); q.style.cssText='border-left:3px solid #4a148c;background:rgba(0,0,0,0.06);padding:4px 6px;margin-bottom:4px;border-radius:4px;font-size:11px;'; q.innerHTML=`<b>${m.reply_to_name}</b><br>${m.reply_to_text||''}`; bubble.appendChild(q); }
  if(m.text){ const t=document.createElement('div'); t.textContent=m.text; t.style.fontSize='14px'; bubble.appendChild(t); }
  if(m.file_url){ if(m.file_type?.startsWith('image/')){ const img=document.createElement('img'); img.src=m.file_url; img.style.maxWidth='200px'; img.style.borderRadius='10px'; bubble.appendChild(img); } else if(m.file_type?.startsWith('audio/')){ const a=document.createElement('audio'); a.src=m.file_url; a.controls=true; bubble.appendChild(a); } }
  const meta=document.createElement('div'); meta.style.cssText='font-size:10px;color:#888;text-align:right;margin-top:4px;display:flex;gap:6px;justify-content:flex-end;';
  meta.innerHTML=`<span>${formatTime(m.created_at)}</span><span onclick="setReply('${m.id}','${m.sender_name}','${(m.text||'').replace(/'/g,"")}')" style="cursor:pointer;color:#4a148c;font-weight:bold">↩</span>`;
  bubble.appendChild(meta); row.appendChild(bubble); box.appendChild(row); box.scrollTop=box.scrollHeight;
}
function setReply(id,name,text){ pendingReply={id,name,text:text.substring(0,80)}; document.getElementById('reply-to-name').textContent='Replying to '+name; document.getElementById('reply-to-text').textContent=text; document.getElementById('reply-preview').classList.remove('hidden'); document.getElementById('reply-preview').style.display='flex'; }
document.getElementById('reply-cancel').onclick=()=>{ pendingReply=null; document.getElementById('reply-preview').style.display='none'; };
async function sendMessage(){
  const input=document.getElementById('chat-input'); let text=input.value.trim(); if(!text &&!pendingFile) return;
  const {data} = await supabaseClient.from('private_requests').select('*').or(`and(from_id.eq.${currentUserId},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${currentUserId})`).eq('status','accepted').maybeSingle();
  if(!data){ alert('Request access first'); return; }
  if(pendingFile){
    const file=pendingFile; const fileName=`${roomId}/${currentUserId}_${Date.now()}_${file.name}`;
    const {error}=await supabaseClient.storage.from('chat-files').upload(fileName,file); if(error){ alert(error.message); return; }
    const {data:pub}=supabaseClient.storage.from('chat-files').getPublicUrl(fileName);
    await supabaseClient.from('messages').insert([{text:text||file.name,file_url:pub.publicUrl,file_type:file.type,room_id:roomId,sender_name:currentUser,avatar_url:currentAvatar,sender_id:currentUserId,reply_to_name:pendingReply?.name||null,reply_to_text:pendingReply?.text||null}]);
    pendingFile=null;
  } else {
    await supabaseClient.from('messages').insert([{text,room_id:roomId,sender_name:currentUser,avatar_url:currentAvatar,sender_id:currentUserId,reply_to_name:pendingReply?.name||null,reply_to_text:pendingReply?.text||null}]);
  }
  input.value=''; pendingReply=null; document.getElementById('reply-preview').style.display='none';
}
function connectRealtime(){
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel(`private-${roomId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${roomId}`},p=>appendMessage(p.new)).subscribe();
}

// ========= WEBRTC CALL LOGIC =========
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

function connectCallChannel(){
  if(callChannel) supabaseClient.removeChannel(callChannel);
  callChannel = supabaseClient.channel(`call-${roomId}`);
  callChannel.on('broadcast', { event: 'call-offer' }, async (payload)=>{
    if(payload.payload.to!== currentUserId) return;
    if(payload.payload.type === 'offer'){
      incomingOffer = payload.payload;
      showIncomingCall(payload.payload.callType);
    } else if(payload.payload.type === 'answer'){
      if(pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.payload.sdp));
    } else if(payload.payload.type === 'ice'){
      if(pc) try{ await pc.addIceCandidate(payload.payload.candidate); }catch(e){}
    } else if(payload.payload.type === 'end'){
      endCall(false);
    }
    let presenceChannelPrivate = null;

function connectCallChannel(){
  if(callChannel) supabaseClient.removeChannel(callChannel);
  callChannel = supabaseClient.channel(`call-${roomId}`);
  callChannel.on('broadcast', { event: 'call-offer' }, async (payload)=>{
    if(payload.payload.to!== currentUserId) return;
    if(payload.payload.type === 'offer'){
      incomingOffer = payload.payload;
      showIncomingCall(payload.payload.callType);
    } else if(payload.payload.type === 'answer'){
      if(pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.payload.sdp));
    } else if(payload.payload.type === 'ice'){
      if(pc) try{ await pc.addIceCandidate(payload.payload.candidate); }catch(e){}
    } else if(payload.payload.type === 'end'){
      endCall(false);
    }
  }).subscribe();

  // ONLINE PRESENCE FOR PRIVATE CHAT
  if(presenceChannelPrivate) supabaseClient.removeChannel(presenceChannelPrivate);
  presenceChannelPrivate = supabaseClient.channel(`presence-private-${roomId}`, { config: { presence: { key: currentUserId } } });
  presenceChannelPrivate.on('presence', { event: 'sync' }, ()=>{
    const state = presenceChannelPrivate.presenceState();
    const users = [];
    for(const id in state){ state[id].forEach(p=> users.push(p)); }
    const isTargetOnline = users.some(u=> u.id === targetId);
    const statusEl = document.getElementById('target-status');
    if(isTargetOnline){
      statusEl.textContent = '● Online • Private chat';
      statusEl.style.color = '#00ff88';
    } else {
      statusEl.textContent = '○ Offline • Last seen recently';
      statusEl.style.color = 'rgba(255,255,255,0.7)';
    }
  });
  presenceChannelPrivate.subscribe(async (status)=>{
    if(status==='SUBSCRIBED'){
      await presenceChannelPrivate.track({ id: currentUserId, name: currentUser });
    }
  });
}
  }).subscribe();
}
let incomingOffer = null;

async function createPeerConnection(){
  pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (e)=>{
    if(e.candidate){
      callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'ice', candidate:e.candidate } });
    }
  };
  pc.ontrack = (e)=>{ document.getElementById('remote-video').srcObject = e.streams[0]; remoteStream = e.streams[0]; };
  if(localStream){ localStream.getTracks().forEach(track=> pc.addTrack(track, localStream)); }
  return pc;
}

async function startCall(type){
  callType = type;
  const {data} = await supabaseClient.from('private_requests').select('*').or(`and(from_id.eq.${currentUserId},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${currentUserId})`).eq('status','accepted').maybeSingle();
  if(!data){ alert('You need to be connected first. Request access.'); return; }

  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video: type==='video', audio:true });
  }catch(e){ alert('Mic/Camera permission needed: '+e.message); return; }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-overlay').style.display='flex';
  document.getElementById('call-status-text').textContent = type==='video'?'Video calling...':'Voice calling...';
  document.getElementById('local-video').style.display = type==='video'?'block':'none';

  await createPeerConnection();
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'offer', sdp:offer, callType:type, from_name:currentUser, from_avatar:currentAvatar } });
}

function showIncomingCall(type){
  document.getElementById('incoming-call').style.display='block';
  document.getElementById('incoming-name').textContent = targetName + ' is calling...';
  document.getElementById('incoming-type').textContent = type==='video'?'Video call':'Voice call';
}

async function acceptIncomingCall(){
  const offer = incomingOffer;
  document.getElementById('incoming-call').style.display='none';
  callType = offer.callType;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video: callType==='video', audio:true });
  }catch(e){ alert('Permission needed: '+e.message); return; }
  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-overlay').style.display='flex';
  document.getElementById('call-status-text').textContent = 'Connected';
  document.getElementById('local-video').style.display = callType==='video'?'block':'none';

  await createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
  const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
  callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: offer.from, from: currentUserId, type:'answer', sdp:answer } });
}

function endCall(notify=true){
  if(notify && callChannel){ callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: targetId, from: currentUserId, type:'end' } }); }
  document.getElementById('call-overlay').style.display='none';
  document.getElementById('incoming-call').style.display='none';
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  if(pc){ pc.close(); pc=null; }
  document.getElementById('remote-video').srcObject=null;
  document.getElementById('local-video').srcObject=null;
  incomingOffer=null;
}

document.getElementById('voice-call-btn').onclick=()=> startCall('voice');
document.getElementById('video-call-btn').onclick=()=> startCall('video');
document.getElementById('accept-call').onclick=acceptIncomingCall;
document.getElementById('decline-call').onclick=()=>{ document.getElementById('incoming-call').style.display='none'; if(incomingOffer) callChannel.send({ type:'broadcast', event:'call-offer', payload:{ to: incomingOffer.from, from: currentUserId, type:'end' } }); incomingOffer=null; };
document.getElementById('end-call-btn').onclick=()=> endCall(true);
document.getElementById('mute-btn').onclick=(e)=>{
  if(!localStream) return;
  const track=localStream.getAudioTracks()[0];
  if(track){ track.enabled=!track.enabled; e.currentTarget.textContent=track.enabled?'🔇':'🔈'; }
};
document.getElementById('toggle-video-btn').onclick=(e)=>{
  if(!localStream) return;
  const track=localStream.getVideoTracks()[0];
  if(track){ track.enabled=!track.enabled; e.currentTarget.textContent=track.enabled?'🎥':'🚫'; }
};

document.getElementById('send-btn').onclick=sendMessage;
document.getElementById('chat-input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); } });
document.getElementById('attach-btn').onclick=()=>document.getElementById('file-input').click();
document.getElementById('file-input').addEventListener('change',e=>{ pendingFile=e.target.files[0]; });

ensureAuth();
