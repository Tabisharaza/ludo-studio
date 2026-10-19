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

function fixture({preference='auto',osReduced=false,initial=roll(createGame(),6).state}={}){
  const nodes=new Map(),storage=new Map([['ludo-motion',preference],['ludo-studio-v2',JSON.stringify(initial)]]),session=new Map(),timers=new Map(),requests=[];
  const document={hidden:false,addEventListener(){}};
  document.body=new Element(document,'body');document.documentElement=new Element(document,'html');document.activeElement=document.body;
  document.createElement=tag=>new Element(document,tag);
  document.getElementById=id=>{if(!nodes.has(id)){const node=new Element(document,id==='motion-setting'?'select':/^(roll|dice-tap|.*-open|rules-close|rules-bottom|copy-link|retry|start|join)$/.test(id)?'button':'div');node.id=id;document.body.append(node);nodes.set(id,node);}return nodes.get(id);};
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key)};
  let timerId=0,diceOptions,diceCancels=0,nextResponse=null;
  const context=vm.createContext({moveOptions,turnCue,parseInvite,
    document,localStorage,sessionStorage,structuredClone,crypto:webcrypto,AbortController,console,
    createGame,current,legalMoves,roll,move,coordinate,PATH,LANES,START,SAFE,tokenChanges,replayEvents,
    colors:['red','green','gold','blue'],boardSVG:()=>'<svg/>',pawnSVG:()=>'<svg/>',
    matchMedia:()=>({matches:osReduced}),
    createDice:(root,options)=>{diceOptions=options;return {active:false,show(value){root.dataset.value=String(value);},cancel(){diceCancels++;},start(){},async settle(){}};},
    createTokenMotion:()=>({active:false,cancel(){},async play(){}}),
    location:{hash:'',pathname:'/',origin:'https://example.test'},history:{replaceState(){}},navigator:{clipboard:{async writeText(){}}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});assert.ok(nextResponse,'Unexpected production fetch');return {ok:true,status:200,json:async()=>structuredClone(nextResponse)};}
  });
  const get=code=>vm.runInContext(code,context);
  get(source);
  const $=id=>document.getElementById(id);
  function online({disconnected=false}={}){
    context.roomState={code:'ROOM',token:'TOKEN',version:4,ready:true,seat:0,joined:[true,true],disconnected};
    get('online=roomState;diceContext="ROOM";render()');
  }
  function response({version=4,state=initial,...rest}={}){return {code:'ROOM',version,state:structuredClone(state),ready:true,seat:0,joined:[true,true],event:'Server state',...rest};}
  return {$,document,storage,requests,timers,get,context,online,response,setResponse:value=>{nextResponse=value;},get diceOptions(){return diceOptions;},get diceCancels(){return diceCancels;}};
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
  await f.$('piece-actions').children[0].dispatch('focus');assert.equal(f.get('previewLayer.children.length'),6);assert.equal(f.get('previewLayer.children[5].textContent'),'1');assert.equal(f.$('move-detail').hidden,false);assert.equal(f.get('JSON.stringify(state)'),before);
  await f.$('piece-actions').children[0].dispatch('blur');assert.equal(f.get('previewLayer.children.length'),0);assert.equal(f.$('move-detail').hidden,true);
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

console.log(`${passed} arena motion-preference, polling and keyboard-focus checks passed. Real-device layout remains unverified.`);
