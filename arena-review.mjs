import {terminalRoomFailure} from './public/connection.mjs';
import {moveOptions,turnCue,parseInvite} from './public/guidance.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createGame,current,legalMoves,roll,move,coordinate,PATH,LANES,START,SAFE} from './public/engine.mjs';
import {tokenChanges,replayEvents} from './public/motion.mjs';

// Run the production app, including its real event handlers and poll transport,
// against a small DOM with focus/removal semantics. No browser or network is used.
// These checks do not certify CSS layout, safe areas, or real-device rendering.
const source=readFileSync(new URL('./public/app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const css=readFileSync(new URL('./public/style.css',import.meta.url),'utf8');
let passed=0;
async function test(name,check){await check();passed++;console.log('PASS',name);}

class Element {
  constructor(document,tag='div'){
    this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];
    this.dataset={};this.attributes={};this.listeners=new Map();this.hidden=false;this.open=false;
    this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
    this.classes=new Set();this.replaceCount=0;this.focusCalls=[];
    this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v),toggle:(v,on)=>{on=on??!this.classes.has(v);on?this.classes.add(v):this.classes.delete(v);return on;}};
  }
  append(child){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);child.parentElement=this;this.children.push(child);}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  replaceChildren(...children){
    this.replaceCount++;
    if(this.children.some(child=>child.contains(this.ownerDocument.activeElement)))this.ownerDocument.activeElement=this.ownerDocument.body;
    for(const child of this.children)child.parentElement=null;
    this.children=[];children.forEach(child=>this.append(child));
  }
  get firstElementChild(){return this.children[0]??null;}
  set disabled(value){this._disabled=Boolean(value);if(this._disabled&&this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=this.ownerDocument.body;}
  get disabled(){return this._disabled??false;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  async dispatch(name,event={}){for(const fn of this.listeners.get(name)??[])await fn({target:this,...event});}
  focus(options){if(this.disabled||this.hidden)return;this.focusCalls.push(options);this.ownerDocument.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
}

function fixture({preference='auto',osReduced=false,initial=roll(createGame(),6).state,savedRoom=null,startupResponse=null}={}){
  const nodes=new Map(),storage=new Map([['ludo-motion',preference],['ludo-studio-v2',JSON.stringify(initial)]]),session=new Map(savedRoom?[['ludo-room-v1',JSON.stringify(savedRoom)]]:[]),timers=new Map(),requests=[];
  const document={hidden:false,addEventListener(){}};
  document.body=new Element(document,'body');document.documentElement=new Element(document,'html');document.activeElement=document.body;
  document.createElement=tag=>new Element(document,tag);
  document.getElementById=id=>{if(!nodes.has(id)){const node=new Element(document,id==='motion-setting'?'select':/^(roll|dice-tap|.*-open|rules-close|rules-bottom|copy-link|retry|start|join)$/.test(id)?'button':'div');node.id=id;document.body.append(node);nodes.set(id,node);}return nodes.get(id);};
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key)};
  const historyChanges=[];let timerId=0,diceOptions,diceCancels=0,nextResponse=startupResponse?.value??null,nextStatus=startupResponse?.status??200,nextError=startupResponse?.error??null;
  const context=vm.createContext({moveOptions,turnCue,parseInvite,terminalRoomFailure,
    document,localStorage,sessionStorage,structuredClone,crypto:webcrypto,AbortController,console,
    createGame,current,legalMoves,roll,move,coordinate,PATH,LANES,START,SAFE,tokenChanges,replayEvents,
    colors:['red','green','gold','blue'],boardSVG:()=>'<svg/>',pawnSVG:()=>'<svg/>',
    matchMedia:()=>({matches:osReduced}),
    createDice:(root,options)=>{diceOptions=options;return {active:false,show(value){root.dataset.value=String(value);},cancel(){diceCancels++;},start(){},async settle(){}};},
    createTokenMotion:()=>({active:false,cancel(){},async play(){}}),
    location:{hash:'',pathname:'/',origin:'https://example.test'},history:{replaceState(...args){historyChanges.push(args[2]);}},navigator:{clipboard:{async writeText(){}}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});if(nextError)throw nextError;assert.ok(nextResponse,'Unexpected production fetch');return {ok:nextStatus>=200&&nextStatus<300,status:nextStatus,json:async()=>structuredClone(nextResponse)};}
  });
  const get=code=>vm.runInContext(code,context);
  get(source);
  const $=id=>document.getElementById(id);
  function online({disconnected=false}={}){
    context.roomState={code:'ROOM',token:'TOKEN',version:4,ready:true,seat:0,joined:[true,true],disconnected};
    get('online=roomState;diceContext="ROOM";render()');
  }
  function response({version=4,state=initial,...rest}={}){return {code:'ROOM',version,state:structuredClone(state),ready:true,seat:0,joined:[true,true],event:'Server state',...rest};}
  return {$,document,storage,session,requests,timers,historyChanges,get,context,online,response,setResponse:(value,status=200)=>{nextResponse=value;nextStatus=status;nextError=null;},setFailure:error=>{nextError=error;},get diceOptions(){return diceOptions;},get diceCancels(){return diceCancels;}};
}

await test('saved motion choices initialize both UI attribute and JS preference',()=>{
  for(const preference of ['auto','full','reduced']){
    const f=fixture({preference});
    assert.equal(f.$('motion-setting').value,preference);
    assert.equal(f.document.documentElement.getAttribute('data-motion'),preference);
    assert.equal(f.diceOptions.reduced(),preference==='reduced');
  }
});

await test('invalid saved motion choice safely falls back to auto',()=>{
  const f=fixture({preference:'invalid',osReduced:true});
  assert.equal(f.$('motion-setting').value,'auto');
  assert.equal(f.document.documentElement.getAttribute('data-motion'),'auto');
  assert.equal(f.diceOptions.reduced(),true);
});

await test('auto follows the OS and full explicitly overrides JS reduction',()=>{
  assert.equal(fixture({preference:'auto',osReduced:false}).diceOptions.reduced(),false);
  assert.equal(fixture({preference:'auto',osReduced:true}).diceOptions.reduced(),true);
  assert.equal(fixture({preference:'full',osReduced:true}).diceOptions.reduced(),false);
});

await test('motion change handler updates CSS attribute, JS behavior and saved choice',async()=>{
  const f=fixture({osReduced:false});
  for(const preference of ['reduced','full','auto']){
    f.$('motion-setting').value=preference;
    await f.$('motion-setting').dispatch('change');
    assert.equal(f.document.documentElement.getAttribute('data-motion'),preference);
    assert.equal(f.storage.get('ludo-motion'),preference);
    assert.equal(f.diceOptions.reduced(),preference==='reduced');
  }
});

await test('explicit reduced-motion CSS covers elements and both pseudo-elements',()=>{
  const rule=css.match(/(html\[data-motion=["']reduced["']\][^{]+)\{([^}]+)\}/);
  assert.ok(rule,'Missing explicit reduced-motion CSS rule');
  for(const selector of ['html[data-motion="reduced"] *','html[data-motion="reduced"] *:before','html[data-motion="reduced"] *:after'])assert.ok(rule[1].split(',').map(s=>s.trim()).includes(selector),`Missing ${selector}`);
  assert.match(rule[2],/animation\s*:\s*none\s*!important/);
  assert.match(rule[2],/transition\s*:\s*none\s*!important/);
});

await test('unchanged production poll preserves focused move and existing DOM nodes',async()=>{
  const f=fixture();f.online();
  const moves=f.$('piece-actions'),focused=moves.children[2];focused.focus();
  const replacements=moves.replaceCount,playerReplacements=f.$('players').replaceCount,cancels=f.diceCancels;
  f.setResponse(f.response());await f.get('poll()');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/state/ROOM');
  assert.equal(moves.replaceCount,replacements);assert.equal(f.$('players').replaceCount,playerReplacements);
  assert.equal(moves.children[2],focused);assert.equal(f.document.activeElement,focused);
  assert.equal(f.diceCancels,cancels);assert.equal(f.get('visualBusy'),false);
  assert.ok([...f.timers.values()].some(timer=>timer.delay===1800),'Polling must remain scheduled');
});

await test('same-version disconnected poll still restores connection and enabled moves',async()=>{
  const f=fixture();f.online({disconnected:true});assert.equal(f.$('piece-actions').children.length,0);
  const before=f.$('piece-actions').replaceCount;
  f.setResponse(f.response());await f.get('poll()');
  assert.equal(f.get('online.disconnected'),false);assert.equal(f.$('retry').hidden,true);
  assert.ok(f.$('piece-actions').replaceCount>before);assert.equal(f.$('piece-actions').children.length,4);
  assert.equal(f.get('visualBusy'),false);
});

await test('normal rerender restores the same move index including index zero',()=>{
  const f=fixture();f.online();
  for(const index of [0,2]){
    const old=f.$('piece-actions').children[index];assert.equal(old.dataset.move,String(index));old.focus();
    f.get('render()');
    const replacement=f.$('piece-actions').children[index];assert.notEqual(replacement,old);
    assert.equal(f.document.activeElement,replacement);assert.equal(replacement.dataset.move,String(index));
    assert.equal(replacement.focusCalls.at(-1)?.preventScroll,true,'Restoring focus must not scroll the board away');
  }
});

await test('rerender does not steal focus from unrelated header controls',()=>{
  const f=fixture();const headerButton=f.$('new-open');headerButton.focus();f.get('render()');
  assert.equal(f.document.activeElement,headerButton);
});

await test('a newer room version still applies instead of being skipped',async()=>{
  const f=fixture();f.online();
  const moved=move(roll(createGame(),6).state,0).state;
  f.setResponse(f.response({version:5,state:moved}));await f.get('poll()');
  assert.equal(f.get('online.version'),5);assert.equal(f.get('state.tokens[0][0]'),0);
  assert.equal(f.get('state.dice'),null);assert.equal(f.$('roll').disabled,false);
});

await test('online roll restores keyboard focus to a legal move without scrolling',async()=>{
  const initial=createGame(),f=fixture({initial});f.online();f.$('roll').focus();
  f.setResponse(f.response({version:5,state:roll(initial,6).state}));await f.get('rollDice()');
  const moveButton=f.$('piece-actions').firstElementChild;
  assert.ok(moveButton);assert.equal(f.document.activeElement,moveButton);
  assert.equal(moveButton.focusCalls.at(-1)?.preventScroll,true);
});

await test('online bonus move restores keyboard focus to the next roll',async()=>{
  const initial=roll(createGame(),6).state,f=fixture({initial});f.online();f.$('piece-actions').firstElementChild.focus();
  f.setResponse(f.response({version:5,state:move(initial,0).state}));await f.get('choose(0)');
  assert.equal(f.document.activeElement,f.$('roll'));assert.equal(f.$('roll').disabled,false);
  assert.equal(f.$('roll').focusCalls.at(-1)?.preventScroll,true);
});

await test('an online action completion does not take focus from an opened dialog',async()=>{
  const initial=createGame(),f=fixture({initial});f.online();f.$('roll').focus();
  f.setResponse(f.response({version:5,state:roll(initial,6).state}));
  const pending=f.get('rollDice()');f.$('rules-dialog').showModal();f.$('rules-close').focus();await pending;
  assert.equal(f.document.activeElement,f.$('rules-close'));assert.equal(f.$('rules-dialog').open,true);
});

await test('move cards expose illegal reasons while keeping legal choices actionable',()=>{
  const initial=createGame();initial.tokens[0]=[54,-1,12,56];initial.dice=4;const f=fixture({initial});
  const cards=f.$('piece-actions').children;assert.equal(cards.length,4);assert.equal(cards[0].disabled,true);assert.match(cards[0].getAttribute('aria-label'),/Needs 2 or less/);assert.equal(cards[1].disabled,true);assert.equal(cards[2].disabled,false);assert.equal(cards[3].disabled,true);
});
await test('focus and pointer preview draw the legal route without changing the game',async()=>{
  const initial=createGame();initial.tokens[0][0]=3;initial.dice=6;const f=fixture({initial}),before=f.get('JSON.stringify(state)');
  await f.$('piece-actions').children[0].dispatch('focus');assert.equal(f.get('previewLayer.children.length'),6);assert.equal(f.get('previewLayer.children[5].textContent'),'1');assert.equal(f.$('move-detail').hidden,false);assert.equal(f.$('turn-cue').hidden,true);assert.equal(f.get('JSON.stringify(state)'),before);
  await f.$('piece-actions').children[0].dispatch('blur');assert.equal(f.get('previewLayer.children.length'),0);assert.equal(f.$('move-detail').hidden,true);assert.equal(f.$('turn-cue').hidden,false);
});
await test('preview disappears during playback and never exposes opponent choices',()=>{
  const f=fixture();f.get('previewMove(0)');assert.equal(f.get('previewLayer.children.length'),1);f.get('busy=true;render();previewMove(0)');assert.equal(f.get('previewLayer.children.length'),0);
  f.get('busy=false');f.online();f.get('online.seat=1;render();previewMove(0)');assert.equal(f.get('previewLayer.children.length'),0);
});
await test('hovering an opposing pawn cannot preview a current-player pawn with the same index',async()=>{
  const f=fixture();await f.get('tokens[2][0]').dispatch('pointerenter');assert.equal(f.get('previewLayer.children.length'),0);
});
await test('online keyboard focus skips disabled piece cards after roll',async()=>{
  const initial=createGame();initial.tokens[0]=[55,10,-1,56];const f=fixture({initial});f.online();f.$('roll').focus();
  f.setResponse(f.response({version:5,state:roll(initial,2).state}));await f.get('rollDice()');assert.equal(f.document.activeElement.dataset.move,'1');assert.equal(f.document.activeElement.disabled,false);
});
await test('disconnected keyboard entry cannot send a fresh roll or move',async()=>{
  const f=fixture({initial:createGame()});f.online({disconnected:true});await f.get('rollDice()');assert.equal(f.requests.length,0);
  const g=fixture();g.online({disconnected:true});await g.get('choose(0)');assert.equal(g.requests.length,0);
});
await test('open dialogs block online action entry consistently',async()=>{
  const f=fixture({initial:createGame()});f.online();f.$('rules-dialog').showModal();await f.get('rollDice()');assert.equal(f.requests.length,0);
  const g=fixture();g.online();g.$('new-dialog').showModal();await g.get('choose(0)');assert.equal(g.requests.length,0);
});
await test('empty online seats and own seat have distinct readable labels',()=>{
  const f=fixture();f.online();f.get('online.ready=false;online.joined=[true,false];render()');
  assert.match(f.$('players').children[0].innerHTML,/YOU/);assert.match(f.$('players').children[1].innerHTML,/WAITING FOR FRIEND/);assert.match(f.$('players').children[1].className,/seat-empty/);assert.equal(f.$('turn-name').textContent,'Waiting for friends');
});
await test('paste-and-join sends only the parsed room code',async()=>{
  const f=fixture();f.$('room-code').value='https://example.test/#room=abcdef0123456789';f.$('count').value='2';f.setResponse({...f.response(),code:'ABCDEF0123456789'});await f.$('join').dispatch('click');
  assert.equal(f.requests[0].path,'/api/join/ABCDEF0123456789');assert.equal(f.get('online.code'),'ABCDEF0123456789');
});

await test('ordinary in-flight actions do not show the recovery button',()=>{const f=fixture();f.online();f.get('busy=true;pendingAction={kind:"roll"};render()');assert.equal(f.$('retry').hidden,true);assert.equal(f.$('turn-cue').dataset.kind,'busy');f.get('busy=false;render()');assert.equal(f.$('retry').hidden,false);assert.equal(f.$('turn-cue').dataset.kind,'offline');});


// Terminal room/session failures are different from a recoverable connection loss.
const expired={error:'This table has expired or does not exist. Create a new table.',errorCode:'room_unavailable'};
const missingSeat={error:'Your seat session is missing. Rejoin from your original browser tab.',errorCode:'seat_missing'};
const savedRoom=()=>({code:'AABBCCDDEEFF0011',token:'a'.repeat(64),version:4,ready:true,seat:0,joined:[true,true],state:createGame(),expires:1});
async function boot(f){for(let i=0;i<20;i++)await Promise.resolve();return f;}
const pollScheduled=f=>[...f.timers.values()].some(t=>t.delay===1800||t.delay===2500);

await test('only definitive room and seat errors are terminal',()=>{
  for(const [status,value,expected] of [[404,expired,'room'],[401,{errorCode:'invalid_session'},'seat'],[403,missingSeat,'seat'],[403,{error:'It is another player’s turn.'},null],[403,{error:'Origin not allowed.'},null],[409,{},null],[429,{},null],[503,{},null]])assert.equal(terminalRoomFailure({ok:false,status,value})?.kind??null,expected);
  assert.equal(terminalRoomFailure({ok:true,status:200,value:{}}),null);
});
await test('expired polling stops, removes only invalid session and offers recovery',async()=>{
  const f=fixture();f.online();f.get('rememberRoom()');const local=f.storage.get('ludo-studio-v2'),board=f.get('JSON.stringify(state)');
  f.setResponse(expired,404);await f.get('poll()');
  assert.equal(f.get('online.terminal'),'room');assert.equal(f.$('turn-name').textContent,'Table unavailable');assert.equal(f.$('retry').hidden,true);assert.equal(f.$('copy-link').hidden,true);assert.equal(f.$('roll').disabled,true);assert.equal(f.$('piece-actions').children.length,0);assert.equal(f.$('online-open').textContent,'Create / join table');assert.equal(f.document.activeElement,f.$('online-open'));
  assert.equal(pollScheduled(f),false);assert.equal(f.session.has('ludo-room-v1'),false);assert.equal(f.storage.get('ludo-studio-v2'),local);assert.equal(f.get('JSON.stringify(state)'),board);assert.equal(f.historyChanges.at(-1),'/');assert.doesNotMatch(f.$('turn-cue').textContent,/seat is saved|Retry/i);
  await f.get('poll()');await f.get('rollDice()');assert.equal(f.requests.length,1);
});
await test('missing seat polling stops without pretending the table itself expired',async()=>{
  const f=fixture();f.online();f.setResponse(missingSeat,403);await f.get('poll()');
  assert.equal(f.get('online.terminal'),'seat');assert.equal(f.$('turn-name').textContent,'Seat unavailable');assert.match(f.$('status').textContent,/original browser tab/);assert.equal(pollScheduled(f),false);
});
await test('terminal action response clears pending retry and locks stale controls',async()=>{
  for(const [status,value] of [[404,expired],[403,missingSeat],[401,{errorCode:'invalid_session'}]]){
    const f=fixture({initial:createGame()});f.online();f.setResponse(value,status);await f.get('rollDice()');
    assert.ok(f.get('online.terminal'));assert.equal(f.get('pendingAction'),null);assert.equal(f.get('busy'),false);assert.equal(f.$('roll').disabled,true);assert.equal(f.$('retry').hidden,true);assert.equal(pollScheduled(f),false);
    await f.get('sendAction("roll")');await f.get('poll()');assert.equal(f.requests.length,1);
  }
});
await test('reload preserves the definitive expired-room result and stops retrying',async()=>{
  const f=await boot(fixture({savedRoom:savedRoom(),startupResponse:{status:404,value:expired}}));
  assert.equal(f.get('online.terminal'),'room');assert.equal(f.get('busy'),false);assert.match(f.$('status').textContent,/expired or no longer exists/);assert.doesNotMatch(f.$('status').textContent,/seat is saved|Could not reconnect/);assert.equal(pollScheduled(f),false);assert.equal(f.session.has('ludo-room-v1'),false);
});
await test('reload marks an invalid seat as terminal without autojoining another seat',async()=>{
  for(const [status,value] of [[403,missingSeat],[401,{errorCode:'invalid_session'}]]){
    const f=await boot(fixture({savedRoom:savedRoom(),startupResponse:{status,value}}));
    assert.equal(f.get('online.terminal'),'seat');assert.equal(f.requests.length,1);assert.equal(pollScheduled(f),false);assert.equal(f.session.has('ludo-room-v1'),false);
  }
});
await test('server and network failure during reload preserve the valid saved seat',async()=>{
  for(const startupResponse of [{status:503,value:{error:'Temporarily unavailable'}},{error:new Error('Network offline')}]){
    const saved=savedRoom(),f=await boot(fixture({savedRoom:saved,startupResponse}));
    assert.equal(f.get('online.terminal'),undefined);assert.equal(f.get('online.disconnected'),true);assert.equal(f.session.get('ludo-room-v1'),JSON.stringify(saved));assert.equal(pollScheduled(f),true);assert.equal(f.historyChanges.length,0);
    f.setResponse(f.response({code:saved.code,state:saved.state}));await f.get('poll()');assert.equal(f.get('online.disconnected'),false);assert.equal(f.$('roll').disabled,false);
  }
});
await test('temporary poll errors retain session and can reconnect at the same version',async()=>{
  for(const status of [429,503]){
    const f=fixture();f.online();f.get('rememberRoom()');const saved=f.session.get('ludo-room-v1');f.setResponse({error:'Try later'},status);await f.get('poll()');
    assert.equal(f.get('online.terminal'),undefined);assert.equal(f.session.get('ludo-room-v1'),saved);assert.equal(pollScheduled(f),true);assert.equal(f.$('retry').hidden,false);
    f.setResponse(f.response());await f.get('poll()');assert.equal(f.get('online.disconnected'),false);
  }
});
await test('temporary action failure retains the exact idempotent retry',async()=>{
  const f=fixture({initial:createGame()});f.online();f.get('rememberRoom()');const saved=f.session.get('ludo-room-v1');f.setFailure(new Error('offline'));await f.get('rollDice()');const id=f.requests[0].body.actionId;
  assert.equal(f.get('pendingAction.actionId'),id);assert.equal(f.get('online.terminal'),undefined);assert.equal(f.session.get('ludo-room-v1'),saved);
  f.setResponse(f.response({version:5,state:roll(createGame(),6).state}));await f.$('retry').dispatch('click');assert.equal(f.requests[1].body.actionId,id);assert.equal(f.get('pendingAction'),null);assert.equal(f.get('online.disconnected'),false);
});
await test('an ordinary forbidden-turn response never clears a valid seat',async()=>{
  const f=fixture({initial:createGame()});f.online();f.get('rememberRoom()');const saved=f.session.get('ludo-room-v1');f.setResponse({error:'It is another player’s turn.'},403);await f.get('rollDice()');
  assert.equal(f.get('online.terminal'),undefined);assert.equal(f.session.get('ludo-room-v1'),saved);assert.equal(f.historyChanges.length,0);
});
await test('late successful polling cannot resurrect a terminal session',async()=>{
  const f=fixture();f.online();let finish;f.context.fetch=()=>new Promise(resolve=>finish=resolve);const pending=f.get('poll()');
  f.get('endRoom({ok:false,status:404,value:{}});render()');finish({ok:true,status:200,json:async()=>f.response({version:5})});await pending;
  assert.equal(f.get('online.terminal'),'room');assert.equal(pollScheduled(f),false);assert.equal(f.session.has('ludo-room-v1'),false);assert.equal(f.$('retry').hidden,true);
});
await test('late terminal polling from an old room cannot invalidate a new room',async()=>{
  const f=fixture();f.online();let finish;f.context.fetch=()=>new Promise(resolve=>finish=resolve);const pending=f.get('poll()');
  f.get('online={...online,code:"OTHER",token:"OTHER_TOKEN"}');finish({ok:false,status:404,json:async()=>expired});await pending;
  assert.equal(f.get('online.code'),'OTHER');assert.equal(f.get('online.terminal'),undefined);
});
await test('terminal recovery opens the lobby and permits a fresh valid table',async()=>{
  const f=fixture();f.online();f.setResponse(expired,404);await f.get('poll()');await f.$('online-open').dispatch('click');assert.equal(f.$('new-dialog').open,true);assert.equal(f.$('mode').value,'online');
  f.setResponse(f.response({code:'1122334455667788',state:createGame()}));await f.get('enterRoom("create")');
  assert.equal(f.get('online.terminal'),undefined);assert.equal(f.get('online.code'),'1122334455667788');assert.equal(f.$('new-dialog').open,false);assert.equal(f.$('roll').disabled,false);assert.equal(pollScheduled(f),true);assert.equal(f.session.has('ludo-room-v1'),true);
});
await test('terminal poll during an action or replay cancels busy recovery immediately',async()=>{
  for(const flag of ['busy','visualBusy'])for(const [status,value] of [[404,expired],[403,missingSeat]]){
    const f=fixture();f.online();f.get(`rememberRoom();${flag}=true;pendingAction={kind:'roll',actionId:'pending'}`);f.setResponse(value,status);await f.get('poll()');
    assert.ok(f.get('online.terminal'));assert.equal(f.get('busy'),false);assert.equal(f.get('visualBusy'),false);assert.equal(f.get('pendingAction'),null);assert.equal(f.session.has('ludo-room-v1'),false);assert.equal(pollScheduled(f),false);
    f.setFailure(new Error('offline'));await f.get('poll()');assert.equal(f.requests.length,1);assert.doesNotMatch(f.$('turn-cue').textContent,/seat is saved/i);
  }
});
await test('late action success and failure cannot overwrite terminal feedback',async()=>{
  for(const outcome of ['success','failure']){
    const f=fixture({initial:createGame()});f.online();let resolve,reject;f.context.fetch=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});const pending=f.get('rollDice()');
    f.get('endRoom({ok:false,status:404,value:{}});render()');const message=f.$('status').textContent;
    if(outcome==='success')resolve({ok:true,status:200,json:async()=>f.response({version:5})});else reject(Error('offline'));await pending;
    assert.equal(f.$('status').textContent,message);assert.equal(f.get('online.terminal'),'room');assert.equal(f.get('busy'),false);assert.equal(pollScheduled(f),false);
  }
});
await test('late action completion cannot unlock a replacement room in-flight action',async()=>{
  const f=fixture({initial:createGame()});f.online();let finish;f.context.fetch=()=>new Promise(resolve=>finish=resolve);const pending=f.get('rollDice()');
  f.get('endRoom({ok:false,status:404,value:{}});online={...online,code:"NEW",token:"NEW_TOKEN",terminal:undefined,disconnected:false};busy=true;pendingAction={actionId:"new-action"}');finish({ok:true,status:200,json:async()=>f.response({version:5})});await pending;
  assert.equal(f.get('online.code'),'NEW');assert.equal(f.get('busy'),true);assert.equal(f.get('pendingAction.actionId'),'new-action');
});
await test('non-JSON errors preserve definitive HTTP status but never guess a missing-seat 403',async()=>{
  for(const status of [404,401,403,503]){
    const f=fixture();f.online();f.get('rememberRoom()');f.context.fetch=async()=>({ok:false,status,json:async()=>{throw new SyntaxError('not JSON');}});await f.get('poll()');
    assert.equal(!!f.get('online.terminal'),status===404||status===401);assert.equal(f.session.has('ludo-room-v1'),status!==404&&status!==401);assert.equal(pollScheduled(f),status!==404&&status!==401);
  }
});
await test('terminal recovery does not steal keyboard focus from an open dialog',async()=>{
  const f=fixture();f.online();f.$('rules-dialog').showModal();f.$('rules-close').focus();f.setResponse(expired,404);await f.get('poll()');assert.equal(f.document.activeElement,f.$('rules-close'));
});

console.log(`${passed} arena motion-preference, polling and keyboard-focus checks passed. Real-device layout remains unverified.`);
