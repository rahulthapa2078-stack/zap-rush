(() => {
  const $ = id => document.getElementById(id);
  const socket = io({ transports: ['websocket', 'polling'] });
  const avatarMap = { bolt:'⚡', fox:'🦊', cat:'🐱', robot:'🤖', alien:'👾', shark:'🦈', tiger:'🐯', ghost:'👻', dragon:'🐲', panda:'🐼', owl:'🦉', rocket:'🚀' };
  let selectedAvatar = 'bolt', identityAction = 'create', pendingCode = '', roomState = null, myPlayerId = null, roomCode = null, musicOn = false, sfxOn = true, audioCtx = null;
  const stored = (() => { try { return JSON.parse(localStorage.getItem('zapRushSession') || 'null'); } catch { return null; } })();
  function saveSession(data) { localStorage.setItem('zapRushSession', JSON.stringify(data)); }
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  let toastTimer; function toast(msg) { $('toast').textContent = msg; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600); }
  function beep(freq=600, duration=.09, type='sine') { if (!sfxOn) return; try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.08,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration); } catch {} }
  function openSetup(action, code='') { identityAction=action;pendingCode=code;show('setup');$('nickname').value=localStorage.getItem('zapRushName')||''; }
  function renderAvatars(){ $('avatars').innerHTML=Object.entries(avatarMap).map(([key,emoji])=>`<button class="avatar-choice ${key===selectedAvatar?'selected':''}" data-avatar="${key}" aria-label="${key}">${emoji}</button>`).join(''); }
  renderAvatars();
  $('avatars').addEventListener('click',e=>{const b=e.target.closest('[data-avatar]');if(!b)return;selectedAvatar=b.dataset.avatar;renderAvatars();});
  $('createBtn').onclick=()=>openSetup('create');
  $('joinToggle').onclick=()=>{$('joinForm').classList.toggle('hidden');if(!$('joinForm').classList.contains('hidden'))$('roomCode').focus();};
  $('joinBtn').onclick=()=>{const code=$('roomCode').value.trim().toUpperCase();if(!/^[A-Z]{4}$/.test(code))return toast('Enter a valid 4-letter room code.');openSetup('join',code);};
  $('roomCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4));
  $('confirmIdentity').onclick=()=>{const name=$('nickname').value.trim();if(name.length<2)return toast('Nickname must be at least 2 characters.');localStorage.setItem('zapRushName',name);if(identityAction==='create')socket.emit('room:create',{name,avatar:selectedAvatar});else socket.emit('room:join',{code:pendingCode,name,avatar:selectedAvatar});};
  $('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')$('confirmIdentity').click();});
  document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show(b.dataset.back));
  $('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast('Room code copied!');}catch{toast(`Room code: ${roomCode}`);}};
  $('startBtn').onclick=()=>socket.emit('game:start'); $('againBtn').onclick=()=>socket.emit('game:again'); $('backLobbyBtn').onclick=()=>show('lobby');
  $('leaveBtn').onclick=()=>{localStorage.removeItem('zapRushSession');location.reload();};
  $('musicToggle').onclick=()=>{musicOn=!musicOn;$('musicToggle').innerHTML=`${musicOn?'♫':'♩'} <small>MUSIC ${musicOn?'ON':'OFF'}</small>`;toast('Background music control is ready; music will be added in polish.');};
  $('soundToggle').onclick=()=>{sfxOn=!sfxOn;$('soundToggle').innerHTML=`${sfxOn?'◖':'◗'} <small>SFX ${sfxOn?'ON':'OFF'}</small>`;};
  $('target').onclick=e=>{e.stopPropagation();socket.emit('game:tap');$('target').classList.add('hidden');};
  $('arena').addEventListener('pointerdown',e=>{if(e.target.id==='target')return;if(roomState?.phase==='waiting')socket.emit('game:tap');});
  socket.on('connect',()=>{let session=null;try{session=JSON.parse(localStorage.getItem('zapRushSession')||'null')}catch{}if(session?.code&&session?.playerId&&session?.resumeToken)socket.emit('room:resume',session);});
  socket.on('room:joined',data=>{roomCode=data.code;myPlayerId=data.playerId;saveSession({code:data.code,playerId:data.playerId,resumeToken:data.resumeToken});$('hudCode').textContent=roomCode;show('lobby');});
  socket.on('app:error',data=>toast(data.message||'Something went wrong.'));
  socket.on('room:update',room=>{roomState=room;renderRoom(room);});
  function renderRoom(room){
    $('playerCount').textContent=`${room.players.length} / 4 PLAYERS`;$('hudPlayers').textContent=`${room.players.length} PLAYERS`;
    $('playerList').innerHTML=room.players.map(p=>`<div class="player-row ${p.connected?'':'offline'}"><div class="player-avatar">${avatarMap[p.avatar]||'⚡'}</div><div class="player-info"><div class="player-name">${escapeHtml(p.name)} ${p.id===myPlayerId?'<span style="color:#8b849d;font-size:11px">(YOU)</span>':''}</div><div class="player-meta">${p.connected?'CONNECTED':'DISCONNECTED'}</div></div>${p.isHost?'<span class="host-tag">HOST</span>':''}</div>`).join('');
    const me=room.players.find(p=>p.id===myPlayerId),isHost=room.hostId===myPlayerId,connected=room.players.filter(p=>p.connected).length;
    $('startBtn').classList.toggle('hidden',!isHost);$('startBtn').disabled=connected<3||room.phase!=='lobby';$('lobbyStatus').textContent=connected<3?`Waiting for ${3-connected} more player${3-connected===1?'':'s'}...`:isHost?'Your squad is ready. Start when you are.':'Waiting for the host to start...';$('hostNote').textContent=isHost?'YOU ARE THE HOST':'Only the host can start the game.';
    if(room.phase==='countdown'||room.phase==='waiting'||room.phase==='playing')show('game');
    if(room.phase==='countdown'){ $('gamePrompt').classList.remove('hidden');$('gamePrompt').innerHTML='<span class="prompt-kicker">GET READY</span><strong>3 · 2 · 1</strong><small>FOCUS. WAIT FOR THE TARGET.</small>'; $('target').classList.add('hidden');$('falseOverlay').classList.add('hidden'); }
    if(room.phase==='waiting'){ $('gamePrompt').classList.remove('hidden');$('gamePrompt').innerHTML='<span class="prompt-kicker">STAY SHARP</span><strong>WAIT<span class="ellipsis">...</span></strong><small>DON\'T TAP UNTIL THE TARGET APPEARS</small>'; $('target').classList.add('hidden');$('falseOverlay').classList.toggle('hidden',!me?.falseStart); }
    if(room.phase==='playing'){ $('gamePrompt').classList.add('hidden');$('falseOverlay').classList.toggle('hidden',!me?.falseStart);if(room.target){$('target').classList.remove('hidden');$('target').style.left=room.target.x+'%';$('target').style.top=room.target.y+'%';} }
    if(room.phase==='results'){show('results');renderResults(room);}
  }
  function renderResults(room){const winner=room.players.find(p=>p.id===room.winnerId);$('resultTitle').innerHTML=winner?'ZAP<br><span>WINNER</span>':'ROUND<br><span>OVER</span>';$('winnerCard').innerHTML=winner?`<div style="font-size:35px">${avatarMap[winner.avatar]||'⚡'}</div><div class="winner-name">${escapeHtml(winner.name)}</div><div class="winner-time">${winner.reactionMs} ms reaction · ${winner.score} points</div>`:'<div class="winner-name">No valid taps this round</div>';
    const sorted=[...room.players].sort((a,b)=>(a.reactionMs??Infinity)-(b.reactionMs??Infinity));$('resultsList').innerHTML=sorted.map((p,i)=>`<div class="results-row ${p.id===room.winnerId?'winner':''}"><div class="results-left"><span class="rank">${i+1}.</span><span class="results-avatar">${avatarMap[p.avatar]||'⚡'}</span><span class="results-player">${escapeHtml(p.name)}${p.falseStart?' 🚨':''}</span></div><div class="results-time">${p.reactionMs==null?'—':p.reactionMs+' ms'}<span class="results-score">${p.score} PTS${p.falseStart?' · FALSE START':''}</span></div></div>`).join('');
    const isHost=room.hostId===myPlayerId;$('againBtn').classList.toggle('hidden',!isHost);$('backLobbyBtn').classList.toggle('hidden',isHost);if(winner)beep(880,.2,'triangle');
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  if(stored?.code){show('home');}
})();
