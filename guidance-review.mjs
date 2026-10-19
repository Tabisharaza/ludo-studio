import assert from 'node:assert/strict';
import {createGame,current,roll,move,legalMoves,coordinate} from './public/engine.mjs';
import {moveOptions,turnCue,parseInvite} from './public/guidance.mjs';
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
function position(tokens,dice=1,count=4){const s=createGame(count);s.tokens[0]=tokens;s.dice=dice;return s;}

test('yard choice needs six and releases only to the start',()=>{
  let s=position([-1,-1,-1,-1],5);assert.ok(moveOptions(s).every(o=>!o.legal&&o.label==='Needs a six'));
  s.dice=6;for(const o of moveOptions(s)){assert.equal(o.kind,'release');assert.equal(o.to,0);assert.deepEqual(o.path,[coordinate(0,0,o.index)]);assert.equal(o.path.length,1);}
});
test('locked capturing piece is explained and never given a destination',()=>{
  const s=position([16,-1,50,56],6);s.locked=[0];const [locked,yard,finish,home]=moveOptions(s);
  assert.equal(locked.label,'Capture locked');assert.equal(locked.legal,false);assert.deepEqual(locked.path,[]);
  assert.equal(yard.legal,true);assert.equal(finish.kind,'home');assert.equal(home.label,'Home');
});
test('overshoot explains exact remaining distance',()=>{
  const o=moveOptions(position([54,56,56,56],6))[0];assert.equal(o.legal,false);assert.equal(o.label,'Needs 2 or less');assert.match(o.detail,/Rolled 6.*2 steps remain/);
});
test('exact final home predicts victory without taking the move',()=>{
  const s=position([54,56,56,56],2),before=structuredClone(s),o=moveOptions(s)[0];assert.equal(o.kind,'home');assert.match(o.detail,/wins the game/);assert.deepEqual(o.path,[[7,5],[7,7]]);assert.deepEqual(s,before);
});
test('non-final home does not claim victory or invent a bonus',()=>{
  const o=moveOptions(position([54,10,56,56],2))[0];assert.equal(o.label,'Finish home');assert.doesNotMatch(o.detail,/wins|bonus|again/);
});
test('capture preview includes all opponents on an unsafe square',()=>{
  const s=position([14,-1,-1,-1],2);s.tokens[1]=[3,3,-1,-1];s.tokens[2]=[42,-1,-1,-1];const o=moveOptions(s)[0];assert.equal(o.captures,3);assert.equal(o.kind,'capture');assert.match(o.detail,/This piece locks/);assert.equal(move(s,0).state.tokens[1][0],-1);
});
test('safe square preview never claims a capture',()=>{
  const s=position([6,-1,-1,-1],2);s.tokens[1][0]=47;const o=moveOptions(s)[0];assert.equal(o.kind,'safe');assert.equal(o.captures,0);assert.match(o.detail,/safe square/);
});
test('home-lane preview never wraps or captures at a shared ring index',()=>{
  const s=position([50,-1,-1,-1],3);s.tokens[1][0]=40;const o=moveOptions(s)[0];assert.equal(o.kind,'lane');assert.equal(o.captures,0);assert.deepEqual(o.path,[[7,1],[7,2],[7,3]]);
});
test('moving within home lane does not say entering it again',()=>{
  assert.match(moveOptions(position([52,-1,-1,-1],2))[0].detail,/Stay in your protected home lane/);
});
test('route preview follows all six actual cells around a corner',()=>{
  const o=moveOptions(position([3,-1,-1,-1],6))[0];assert.deepEqual(o.path,Array.from({length:6},(_,i)=>coordinate(0,4+i,0)));assert.equal(o.to,9);
});
test('finished game and unrolled turn produce no legal previews',()=>{
  const s=position([56,56,56,56],null);s.winner=0;assert.ok(moveOptions(s).every(o=>!o.legal&&o.label==='Game complete'));
  s.winner=null;s.tokens[0]=[-1,2,55,56];assert.ok(moveOptions(s).every(o=>!o.legal));assert.equal(moveOptions(s)[2].label,'1 to home');
});
test('every active color has guidance identical to engine outcomes in seeded play',()=>{
  let seed=24;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(const count of [2,3,4]){let s=createGame(count);for(let i=0;i<2500;i++){
    if(s.winner!==null)s=createGame(count);
    if(s.dice===null)s=roll(s,random(6)+1).state;
    const before=JSON.stringify(s),options=moveOptions(s);assert.deepEqual(options.filter(o=>o.legal).map(o=>o.index),legalMoves(s));assert.equal(JSON.stringify(s),before);
    for(const o of options.filter(o=>o.legal)){const next=move(s,o.index).state,p=current(s);assert.equal(next.tokens[p][o.index],o.to);assert.deepEqual(o.path.at(-1),coordinate(p,o.to,o.index));let captured=0;for(const other of s.players.filter(x=>x!==p))captured+=s.tokens[other].filter((v,j)=>v>=0&&next.tokens[other][j]===-1).length;assert.equal(o.captures,captured);}
    const legal=legalMoves(s);if(legal.length)s=move(s,legal[random(legal.length)]).state;
  }}
});
test('invite parser accepts raw, spaced, grouped and lowercase codes',()=>{
  for(const value of ['ABCDEF0123456789','abcdef0123456789',' ABCD EF01 2345 6789 ','ABCD-EF01-2345-6789'])assert.equal(parseInvite(value),'ABCDEF0123456789');
});
test('invite parser accepts copied HTTP links without visiting them',()=>{
  assert.equal(parseInvite('https://ludo-studio-sentinel.tabisharaza.chatgpt.site/#room=abcdef0123456789'),'ABCDEF0123456789');
});
test('invite parser allows the explicitly supplied development origin',()=>{assert.equal(parseInvite('http://localhost:8792/#room=ABCDEF0123456789','http://localhost:8792'),'ABCDEF0123456789');});
test('invite parser rejects scripts, malformed codes and extra fragment data',()=>{
  for(const value of ['',null,'javascript:#room=ABCDEF0123456789','https://x.test/#room=ABCDEF0123456789&token=private','https://x.test/#room=ABCDEF0123456789','https://ludo-studio-sentinel.tabisharaza.chatgpt.site/other#room=ABCDEF0123456789','not-an-invite','ABCDEF01234567890','A'.repeat(2049)])assert.equal(parseInvite(value),null);
});
const online={ready:true,seat:0,joined:[true,true],disconnected:false};
test('turn cue distinguishes owner turn from a remote player turn',()=>{
  const s=createGame();assert.equal(turnCue(s,online).title,'Your turn');s.turn=1;const cue=turnCue(s,online);assert.equal(cue.title,'Gold is playing');assert.match(cue.hint,/You’re Coral/);
});
test('lobby cue reports unfilled seats without implying connected presence',()=>{
  const cue=turnCue(createGame(4),{...online,ready:false,joined:[true,false,false,true]});assert.equal(cue.kind,'waiting');assert.match(cue.hint,/2 seats left/);
});
test('pending action during normal animation is not a false disconnect',()=>{
  assert.equal(turnCue(createGame(),online,{busy:true,pending:true}).kind,'busy');assert.equal(turnCue(createGame(),online,{pending:true}).kind,'offline');
});
test('disconnected cue explains same-tab seat recovery',()=>{
  const cue=turnCue(createGame(),{...online,disconnected:true});assert.equal(cue.kind,'offline');assert.match(cue.hint,/seat is saved in this tab/);
});
test('capture bonus cue preserves the locked-piece rule',()=>{
  const s=createGame();s.locked=[1];assert.match(turnCue(s,online).hint,/Capture saved.*different piece/);
});
console.log(`${passed} move guidance, seeded consistency, invitation and turn-cue checks passed.`);
