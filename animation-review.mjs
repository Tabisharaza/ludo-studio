import {moveOptions,turnCue,parseInvite} from './public/guidance.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDice,FACE_ROTATIONS,PIPS} from './public/dice.mjs';
import {createClock,createTimeline,createTokenMotion,tokenChanges,movementPlan,replayEvents} from './public/motion.mjs';
import {createGame,current,roll,move,legalMoves,coordinate} from './public/engine.mjs';

// Actual production frame/timeline callbacks run against a deterministic clock.
// Assertions inspect intermediate DOM transforms, positions, visibility and locks.
// A DOM model cannot certify CSS rendering or real-device animation playback.
let passed=0;
async function test(name,check){await check();passed++;console.log('PASS',name);}
const microtasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
class FrameClock {
  time=0; next=1; frames=new Map();
  now=()=>this.time;
  request=fn=>{const id=this.next++;this.frames.set(id,fn);return id;};
  cancel=id=>this.frames.delete(id);
  async advance(ms,step=10){const end=this.time+ms;while(this.time<end){this.time=Math.min(end,this.time+step);const batch=[...this.frames];this.frames.clear();for(const [,fn] of batch)fn(this.time);await microtasks();}}
  async finish(promise,limit=20000){let done=false,error;promise.then(()=>done=true,e=>{error=e;done=true;});for(let elapsed=0;!done&&elapsed<limit;elapsed+=10)await this.advance(10);assert.ok(done,'Animation promise did not finish within its bounded timeline');if(error)throw error;return promise;}
}
class Element {
  constructor(){
    this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];delete this[k.replace(/-([a-z])/g,(_,l)=>l.toUpperCase())];}};
    this.dataset={};this.attributes={};this.children=[];this.hidden=false;this.disabled=false;this.open=false;
    this.classes=new Set();this.classList={add:(...c)=>c.forEach(x=>this.classes.add(x)),remove:(...c)=>c.forEach(x=>this.classes.delete(x)),contains:c=>this.classes.has(c),toggle:(c,v)=>{v=v??!this.classes.has(c);v?this.classes.add(c):this.classes.delete(c);return v;}};
  }
  append(child){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);child.parentElement=this;this.children.push(child);}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];children.forEach(c=>this.append(c));}
  get firstElementChild(){return this.children[0];}
  setAttribute(k,v){this.attributes[k]=String(v);}
  querySelector(s){return this.nodes[s];}
  addEventListener(){} focus(){}
}
const originalDocument=globalThis.document;
globalThis.document={createElement:()=>new Element()};
function diceFixture({reduced=false,clock=new FrameClock()}={}){
  const root=new Element(),home=new Element(),stage=new Element(),stageMount=new Element(),stageTitle=new Element();
  home.append(root);stage.append(stageMount);stage.hidden=true;
  root.nodes=Object.fromEntries(['.dice-cube','.dice-lift','.dice-shadow'].map(n=>[n,new Element()]));
  const view=createDice(root,{clock,reduced:()=>reduced,stage,stageMount,stageTitle});
  return {clock,root,home,stage,stageMount,stageTitle,view,cube:root.nodes['.dice-cube'],lift:root.nodes['.dice-lift']};
}
const cssPosition=(p,at,i)=>{const [r,c]=coordinate(p,at,i);return {left:`${(c+.5)/15*100}%`,top:`${(r+.5)/15*100}%`};};
function tokenFixture(state,{reduced=false,clock=new FrameClock()}={}){
  const board=new Element(),tokens=Array.from({length:4},(_,p)=>Array.from({length:4},(_,i)=>{const n=new Element();Object.assign(n.style,cssPosition(p,state.tokens[p][i],i),{transform:'translate(-50%,-62%)'});n.hidden=state.tokens[p][i]===56;n.style.display=n.hidden?'none':'grid';return n;}));
  return {clock,board,tokens,motion:createTokenMotion(tokens,board,()=>reduced,clock)};
}
const event=(before,after,version,kind,index=null)=>({version,kind,player:current(before),index,value:after.lastRoll,changes:tokenChanges(before,after),description:`Server ${kind}`});
function play(before,value,index){return move(roll(before,value).state,index).state;}

try {
  await test('all six resting faces have correct pips and CSS-facing orientation',()=>{
    const {view,root,cube}=diceFixture();const css=readFileSync('public/style.css','utf8');
    const rotate=(v,axis,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),[x,y,z]=v;return axis==='X'?[x,c*y-s*z,s*y+c*z]:[c*x+s*z,y,-s*x+c*z];};
    assert.equal(cube.children.length,6);
    for(let face=1;face<=6;face++){
      view.show(face);assert.equal(root.dataset.value,face);assert.equal(PIPS[face].length,face);assert.equal(cube.children[face-1].children.filter(n=>n.className==='pip').length,face);
      const rule=css.match(new RegExp(`\\.face-${face}\\{([^}]+)\\}`));assert.ok(rule);
      let normal=[0,0,1];for(const turn of [...rule[1].matchAll(/rotate([XY])\((-?\d+)deg\)/g)].reverse())normal=rotate(normal,turn[1],Number(turn[2]));
      const [x,y]=FACE_ROTATIONS[face];normal=rotate(rotate(normal,'Y',y),'X',x);assert.ok(Math.abs(normal[0])<1e-8&&Math.abs(normal[1])<1e-8&&Math.abs(normal[2]-1)<1e-8);
    }
  });
  await test('dice visibly changes transforms over frames without Element.animate',async()=>{
    const f=diceFixture();assert.equal(f.cube.animate,undefined);const first=f.cube.style.transform;f.view.start();
    assert.equal(f.stage.hidden,false);assert.equal(f.root.parentElement,f.stageMount);const pending=f.view.settle(4);
    await f.clock.advance(100);assert.notEqual(f.cube.style.transform,first);assert.notEqual(f.lift.style.transform,'translateY(0px) rotateZ(0deg)');
    const intermediate=f.cube.style.transform;await f.clock.advance(100);assert.notEqual(f.cube.style.transform,intermediate);
    await f.clock.advance(900);assert.equal(f.view.active,true);assert.equal(f.stage.hidden,false);assert.equal(f.stageTitle.textContent,'Rolling…');
    await f.clock.advance(800);assert.equal(f.stageTitle.textContent,'You rolled 4');assert.equal(f.stage.hidden,false);assert.equal(f.view.active,true);
    await f.clock.finish(pending);assert.equal(f.stage.hidden,true);assert.equal(f.root.parentElement,f.home);assert.equal(f.root.dataset.value,4);assert.equal(f.clock.frames.size,0);
  });
  await test('identical consecutive dice results each produce changing frames and visible result',async()=>{
    const f=diceFixture();for(let n=0;n<2;n++){const resting=f.cube.style.transform;f.view.start();const pending=f.view.settle(6);await f.clock.advance(150);assert.notEqual(f.cube.style.transform,resting);assert.equal(f.stage.hidden,false);await f.clock.finish(pending);assert.equal(f.root.dataset.value,6);}
  });
  await test('reduced motion retains rolling/result stage without tumble',async()=>{
    const f=diceFixture({reduced:true}),rest=f.cube.style.transform;f.view.start();const pending=f.view.settle(3);
    await f.clock.advance(100);assert.equal(f.cube.style.transform,rest);assert.equal(f.stage.hidden,false);assert.equal(f.stageTitle.textContent,'Rolling · reduced motion');
    await f.clock.advance(150);assert.equal(f.stageTitle.textContent,'You rolled 3');assert.equal(f.stage.hidden,false);await f.clock.finish(pending);assert.equal(f.root.dataset.value,3);
  });
  await test('cancelled dice stage cannot reappear or overwrite newer resting face',async()=>{
    const f=diceFixture();f.view.start();const pending=f.view.settle(5);await f.clock.advance(150);f.view.cancel();f.view.show(2);await f.clock.finish(pending);
    assert.equal(f.stage.hidden,true);assert.equal(f.root.parentElement,f.home);assert.equal(f.root.dataset.value,2);assert.equal(f.clock.frames.size,0);
  });
  await test('native timer fallback advances clock when requestAnimationFrame is absent',async()=>{
    const clock=createClock({performance:globalThis.performance,setTimeout,clearTimeout});const before=clock.now();const at=await new Promise(resolve=>clock.request(resolve));assert.ok(at>=before);
  });
  await test('timeline cancellation resolves pending work and stops future draw callbacks',async()=>{
    const clock=new FrameClock(),timeline=createTimeline(clock),frames=[];const pending=timeline.run(500,t=>frames.push(t));await clock.advance(100);timeline.cancel();assert.equal(await pending,false);const count=frames.length;await clock.advance(500);assert.equal(frames.length,count);assert.equal(clock.frames.size,0);
  });
  await test('six-step move follows every board square including corners',async()=>{
    let before=createGame();before.tokens[0][0]=4;before=roll(before,6).state;const after=move(before,0).state,ev=event(before,after,1,'move',0),f=tokenFixture(before);
    assert.deepEqual(movementPlan(before,after,ev).map(p=>p.changes[0].to),[5,6,7,8,9,10]);const pending=f.motion.play(before,after,ev);
    await f.clock.advance(95);assert.notEqual(f.tokens[0][0].style.top,cssPosition(0,4,0).top);assert.notEqual(f.tokens[0][0].style.left,cssPosition(0,10,0).left);
    await f.clock.advance(95);assert.equal(f.tokens[0][0].style.left,cssPosition(0,5,0).left);assert.equal(f.tokens[0][0].style.top,cssPosition(0,5,0).top);
    await f.clock.finish(pending);assert.equal(f.tokens[0][0].style.left,cssPosition(0,10,0).left);assert.equal(f.tokens[0][0].style.top,cssPosition(0,10,0).top);
  });
  await test('yard launch travels visibly before landing on start square',async()=>{
    const before=roll(createGame(),6).state,after=move(before,0).state,f=tokenFixture(before);const pending=f.motion.play(before,after,event(before,after,1,'move',0));
    await f.clock.advance(320);assert.notEqual(f.tokens[0][0].style.left,cssPosition(0,-1,0).left);assert.notEqual(f.tokens[0][0].style.top,cssPosition(0,0,0).top);await f.clock.finish(pending);assert.equal(f.tokens[0][0].style.top,cssPosition(0,0,0).top);
  });
  await test('capture return starts after attacker lands and moves victim to yard',async()=>{
    let before=createGame(4);before.tokens[0][0]=14;before.tokens[1][0]=3;before=roll(before,2).state;const after=move(before,0).state,f=tokenFixture(before),ev=event(before,after,1,'move',0);const pending=f.motion.play(before,after,ev);
    await f.clock.advance(190);assert.equal(f.tokens[1][0].style.left,cssPosition(1,3,0).left);assert.equal(f.tokens[1][0].classList.contains('travelling'),false);
    await f.clock.advance(300);assert.equal(f.tokens[1][0].classList.contains('travelling'),true);assert.notEqual(f.tokens[1][0].style.top,cssPosition(1,3,0).top);
    await f.clock.finish(pending);assert.equal(f.tokens[1][0].style.left,cssPosition(1,-1,0).left);assert.equal(f.tokens[1][0].hidden,false);assert.equal(after.tokens[1][0],-1);
  });
  await test('home arrival reaches center and holds visibly before token hides',async()=>{
    let before=createGame();before.tokens[0][0]=55;before=roll(before,1).state;const after=move(before,0).state,f=tokenFixture(before);const pending=f.motion.play(before,after,event(before,after,1,'move',0));
    await f.clock.advance(420);assert.equal(f.tokens[0][0].style.left,cssPosition(0,56,0).left);assert.equal(f.tokens[0][0].hidden,false);assert.equal(f.board.classList.contains('home-arrival'),true);
    await f.clock.finish(pending);assert.equal(f.tokens[0][0].hidden,true);assert.equal(f.tokens[0][0].style.display,'none');
  });
  await test('cancelling home celebration cannot hide replacement table token',async()=>{
    let before=createGame();before.tokens[0][0]=55;before=roll(before,1).state;const after=move(before,0).state,f=tokenFixture(before);const pending=f.motion.play(before,after,event(before,after,1,'move',0));
    await f.clock.advance(430);f.motion.cancel();f.tokens[0][0].hidden=false;f.tokens[0][0].style.display='grid';await f.clock.finish(pending);assert.equal(f.tokens[0][0].hidden,false);assert.equal(f.tokens[0][0].style.display,'grid');
  });
  await test('mid-hop cancellation clears scale and all outstanding motion frames',async()=>{
    let before=createGame();before.tokens[0][0]=4;before=roll(before,2).state;const after=move(before,0).state,f=tokenFixture(before);const pending=f.motion.play(before,after,event(before,after,1,'move',0));
    await f.clock.advance(90);assert.match(f.tokens[0][0].style.transform,/scale/);f.motion.cancel();await f.clock.finish(pending);assert.equal(f.tokens[0][0].style.transform,'translate(-50%,-62%)');assert.equal(f.clock.frames.size,0);
  });
  await test('post-capture rollback animates only uncommitted moves without reviving victim',async()=>{
    let state=createGame(4);state.tokens[0]=[14,50,56,56];state.tokens[1][0]=3;state=play(state,2,0);state=play(state,6,1);const before=state,after=roll(before,6).state,ev=event(before,after,1,'roll'),f=tokenFixture(before);
    assert.deepEqual(ev.changes,[{player:0,index:1,from:56,to:50}]);assert.equal(f.tokens[0][1].hidden,true);const pending=f.motion.play(before,after,ev);assert.equal(f.tokens[0][1].hidden,false);
    await f.clock.advance(300);assert.equal(f.tokens[1][0].style.left,cssPosition(1,-1,0).left);assert.equal(f.tokens[0][0].classList.contains('travelling'),false);
    await f.clock.finish(pending);assert.equal(f.tokens[0][1].hidden,false);assert.equal(f.tokens[0][1].style.top,cssPosition(0,50,1).top);assert.equal(after.tokens[1][0],-1);
  });

  const source=readFileSync('public/app.mjs','utf8');
  const declarations=['cancelVisuals','rollDice','choose','sameRoom','consumeRoom','queueRoom','drainRoom','applyRoom','sendAction'].map(name=>{
    const line=source.split('\n').find(l=>l.startsWith(`function ${name}(`)||l.startsWith(`async function ${name}(`));assert.ok(line,`Missing ${name}`);return line;
  }).join('\n');
  const renderSource=source.slice(source.indexOf('function render(){'),source.indexOf('function die(){'));
  function appFixture({local=false,state=createGame()}={}){
    const clock=new FrameClock(),dice=diceFixture({clock}),motion=tokenFixture(state,{clock}),nodes=new Map(),requests=[];
    const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
    const document={createElement:()=>new Element(),documentElement:new Element()};
    let id=0,localDice=0;
    const context=vm.createContext({moveOptions,turnCue,parseInvite,initial:structuredClone(state),local,structuredClone,createGame,current,roll,move,legalMoves,coordinate,tokenChanges,replayEvents,diceView:dice.view,tokenMotion:motion.motion,tokens:motion.tokens,$,document,names:['Coral','Mint','Gold','Blue'],colors:['coral','mint','gold','blue'],pawnSVG:()=>'<svg/>',key:'test',localStorage:{setItem(){}},rememberRoom(){},reducedMotion:()=>false,die(){localDice++;return 6;},randomToken:()=>String(++id).padStart(32,'0'),request:(path,data)=>new Promise((resolve,reject)=>requests.push({path,data,resolve,reject}))});
    vm.runInContext('const previewLayer=$("preview-layer");let state=initial,online=local?null:{code:"ROOM",token:"TOKEN",version:1,ready:true,seat:0,joined:[true,true],disconnected:false},pendingAction=null,busy=false,visualBusy=false,diceContext=local?"local":"ROOM",visualEpoch=0,queuedRoom=null,presentedRoll=state.lastRoll,announcement="";'+renderSource+declarations,context);
    const get=expression=>vm.runInContext(expression,context);get('render()');
    const apply=value=>{context.incoming=value;return get('applyRoom(incoming)');};
    const response=(next,events,version)=>({ok:true,status:200,value:{code:'ROOM',version,state:next,events,event:'Authoritative server result',ready:true,seat:0,joined:[true,true]}});
    return {clock,dice,motion,$,requests,get,apply,response,context,get localDice(){return localDice;}};
  }
  await test('local input stays locked through actual dice and path frame playback',async()=>{
    const f=appFixture({local:true});const pending=f.get('rollDice()');await f.get('rollDice()');assert.equal(f.localDice,1);await f.clock.advance(500);assert.equal(f.get('busy'),true);assert.equal(f.$('roll').disabled,true);await f.clock.finish(pending);
    const movement=f.get('choose(0)');await f.get('choose(0)');await f.get('rollDice()');assert.equal(f.localDice,1);await f.clock.advance(300);assert.equal(f.get('busy'),true);assert.equal(f.get('state.tokens[0][0]'),-1);await f.clock.finish(movement);assert.equal(f.get('state.tokens[0][0]'),0);
  });
  await test('full rerender during token playback preserves intermediate position and visibility',async()=>{
    let state=createGame();state.tokens[0][0]=4;state=roll(state,3).state;const f=appFixture({local:true,state}),pending=f.get('choose(0)');await f.clock.advance(95);
    const node=f.motion.tokens[0][0],left=node.style.left,top=node.style.top;f.get('render()');assert.equal(node.style.left,left);assert.equal(node.style.top,top);assert.equal(node.hidden,false);await f.clock.finish(pending);
  });
  await test('remote roll and move received together replay in order before latest state commits',async()=>{
    const before=createGame(),rolled=roll(before,6).state,moved=move(rolled,0).state,events=[event(before,rolled,2,'roll'),event(rolled,moved,3,'move',0)],f=appFixture();const pending=f.apply(f.response(moved,events,3).value);
    await f.clock.advance(600);assert.equal(f.dice.stage.hidden,false);assert.equal(f.get('state.tokens[0][0]'),-1);assert.equal(f.get('visualBusy'),true);assert.equal(f.motion.tokens[0][0].classList.contains('travelling'),false);
    await f.clock.advance(1800);assert.equal(f.dice.stage.hidden,true);assert.equal(f.motion.tokens[0][0].classList.contains('travelling'),true);assert.equal(f.get('visualBusy'),true);
    await f.clock.finish(pending);assert.equal(f.get('state.tokens[0][0]'),0);assert.equal(f.get('online.version'),3);assert.equal(f.get('visualBusy'),false);
  });
  await test('newer room update waits for previous movement instead of resetting it',async()=>{
    let before=createGame();before.tokens[0][0]=2;before=roll(before,6).state;const moved=move(before,0).state,again=roll(moved,2).state,ev1=event(before,moved,2,'move',0),ev2=event(moved,again,3,'roll'),f=appFixture({state:before});
    const first=f.apply(f.response(moved,[ev1],2).value);await f.clock.advance(95);const top=f.motion.tokens[0][0].style.top;f.apply(f.response(again,[ev1,ev2],3).value);assert.equal(f.motion.tokens[0][0].style.top,top);assert.equal(f.get('queuedRoom.version'),3);
    await f.clock.finish(first);for(let n=0;n<500&&f.get('online.version')<3;n++)await f.clock.advance(10);assert.equal(f.get('online.version'),3);assert.equal(f.get('state.lastRoll'),2);assert.equal(f.get('queuedRoom'),null);
  });
  await test('online request never uses local die and repeated clicks cannot create another action',async()=>{
    const f=appFixture(),before=createGame(),after=roll(before,6).state,ev=event(before,after,2,'roll');const pending=f.get('rollDice()');await f.get('rollDice()');assert.equal(f.requests.length,1);assert.equal(f.localDice,0);f.requests[0].resolve(f.response(after,[ev],2));await microtasks();await f.clock.advance(700);assert.equal(f.get('busy'),true);await f.get('choose(0)');assert.equal(f.requests.length,1);await f.clock.finish(pending);assert.equal(f.get('state.dice'),6);
  });
  await test('lost response retries identical action ID without duplicating authoritative roll',async()=>{
    const f=appFixture(),before=createGame(),after=roll(before,6).state,ev=event(before,after,2,'roll');const first=f.get('sendAction("roll")');f.requests[0].reject(Error('offline'));await first;assert.equal(f.get('online.disconnected'),true);
    const retry=f.get('sendAction("roll")');assert.equal(f.requests[1].data.actionId,f.requests[0].data.actionId);f.requests[1].resolve(f.response(after,[ev],2));await microtasks();await f.clock.finish(retry);assert.equal(f.get('state.rolls'),1);assert.equal(f.get('pendingAction'),null);
  });
  await test('cancelled remote playback cannot mutate a replacement room or unlock it',async()=>{
    const before=createGame(),after=roll(before,6).state,f=appFixture();const pending=f.apply(f.response(after,[event(before,after,2,'roll')],2).value);await f.clock.advance(200);
    f.get('cancelVisuals();online={...online,code:"NEW",version:9};diceContext="NEW";state=createGame();visualBusy=true');await f.clock.finish(pending);assert.equal(f.get('online.code'),'NEW');assert.equal(f.get('online.version'),9);assert.equal(f.get('state.rolls'),0);assert.equal(f.get('visualBusy'),true);assert.equal(f.dice.stage.hidden,true);
  });
  await test('cancelling rollback die cannot launch old movement on replacement table',async()=>{
    let before=createGame();before.tokens[0]=[50,55,56,56];before=play(before,6,0);const after=roll(before,6).state,f=appFixture({state:before});
    const pending=f.apply(f.response(after,[event(before,after,2,'roll')],2).value);await f.clock.advance(200);
    f.get('cancelVisuals();online={...online,code:"NEW",version:9};diceContext="NEW";state=createGame();presentedRoll=null;render()');
    const replacementLeft=f.motion.tokens[0][0].style.left,replacementTop=f.motion.tokens[0][0].style.top;await f.clock.finish(pending);
    assert.equal(f.get('presentedRoll'),null);assert.equal(f.motion.tokens[0][0].style.left,replacementLeft);assert.equal(f.motion.tokens[0][0].style.top,replacementTop);assert.equal(f.get('state.tokens[0][0]'),-1);
  });
  await test('event replay rejects inconsistent history and long backlogs',()=>{
    const before=createGame(),after=roll(before,6).state,ev=event(before,after,2,'roll');assert.deepEqual(replayEvents(before,{state:after,events:[ev]},1),[ev]);
    const bad={...ev,changes:[{player:0,index:0,from:4,to:5}]};assert.equal(replayEvents(before,{state:after,events:[bad]},1),null);
    assert.equal(replayEvents(before,{state:after,events:Array.from({length:9},(_,i)=>({...ev,version:i+2}))},1),null);
  });
} finally {
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
}
console.log(`${passed} frame-driven animation/lifecycle checks passed. Real browser/device rendering remains unverified.`);
