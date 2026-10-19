import {current,legalMoves,coordinate,START,SAFE} from './engine.mjs?v=6.0';

// Presentation only. The shared engine remains the sole authority for legality.
export function moveOptions(state){
  const player=current(state),legal=legalMoves(state);
  return state.tokens[player].map((from,index)=>{
    const base={index,from,legal:legal.includes(index),to:from,path:[],captures:0,kind:'blocked',label:'',detail:''};
    if(state.winner!==null)return {...base,label:'Game complete',detail:'All four pieces are home.'};
    if(from===56)return {...base,label:'Home',detail:'This piece has already finished.'};
    if(state.locked.includes(index))return {...base,label:'Capture locked',detail:'This piece captured. Use another piece until your next turn.'};
    if(state.dice===null)return {...base,label:from===-1?'In the yard':`${56-from} to home`,detail:from===-1?'Roll a six to release this piece.':'Roll first to see its destination.'};
    if(!base.legal)return {...base,label:from===-1?'Needs a six':`Needs ${56-from} or less`,detail:from===-1?'A six is needed to leave the yard.':`Rolled ${state.dice}. Only ${56-from} steps remain; you must finish exactly.`};
    const to=from===-1?0:from+state.dice;
    const path=from===-1?[coordinate(player,0,index)]:Array.from({length:state.dice},(_,i)=>coordinate(player,from+i+1,index));
    const cell=(START[player]+to)%52,safe=to<=50&&SAFE.has(cell);
    const captures=to<=50&&!safe?state.players.filter(p=>p!==player).reduce((n,p)=>n+state.tokens[p].filter(pos=>pos>=0&&pos<=50&&(START[p]+pos)%52===cell).length,0):0;
    const kind=to===56?'home':captures?'capture':from===-1?'release':safe?'safe':to>=51?'lane':'move';
    const label={home:'Finish home',capture:`Capture ${captures}`,release:'Leave yard',safe:'Safe square',lane:'Home lane',move:`Move ${state.dice}`}[kind];
    const detail=kind==='home'?(state.tokens[player].filter(p=>p===56).length===3?'Exact finish. This move wins the game.':'Exact finish. This piece reaches home.'):
      captures?`Send ${captures} opposing piece${captures===1?'':'s'} to the yard. This piece locks; roll again with another.`:
      kind==='release'?'Release onto your safe start square. Six earns another roll.':
      `${kind==='safe'?'Land on a safe square. ':kind==='lane'?(from>=51?'Stay in your protected home lane. ':'Enter your protected home lane. '):''}${56-to} steps left to home.${state.dice===6?' Six earns another roll.':''}`;
    return {...base,to,path,captures,kind,label,detail};
  });
}

export function turnCue(state,online,{busy=false,pending=false}={}){
  const names=['Coral','Mint','Gold','Blue'],player=current(state),name=names[player];
  if(online?.terminal)return {kind:'terminal',title:online.terminal==='room'?'Table unavailable':'Seat unavailable',hint:online.terminal==='room'?'Create a new table or join a different invite.':'Use your original tab, or create or join another table.'};
  if(online?.disconnected||pending&&!busy)return {kind:'offline',title:'Connection paused',hint:pending?'Retry safely checks your last action.':'Your seat is saved in this tab. Tap Retry connection.'};
  if(online&&!online.ready){const missing=online.joined.filter(joined=>!joined).length;return {kind:'waiting',title:'Waiting for friends',hint:`${missing} seat${missing===1?'':'s'} left. Copy the invite link to fill your table.`};}
  if(state.winner!==null)return {kind:'won',title:`${names[state.winner]} wins!`,hint:'All four pieces home. Start a new table to play again.'};
  if(busy)return {kind:'busy',title:'Playing the move',hint:'Your table is updating. Moves unlock when the animation finishes.'};
  if(online&&online.seat!==state.turn)return {kind:'waiting',title:`${name} is playing`,hint:`You’re ${names[state.players[online.seat]]}. Watch the board; your turn will light up.`};
  return {kind:'ready',title:online?'Your turn':`${name}’s turn`,hint:state.dice!==null?`Rolled ${state.dice} · ${legalMoves(state).length} legal choice${legalMoves(state).length===1?'':'s'}. Hover or focus to preview.`:state.locked.length?'Capture saved. Roll again using a different piece.':state.tokens[player].every(p=>p===-1)?'Roll a six to bring a piece out.':online?'Tap the dice to roll.':'Pass the screen, then roll.'};
}

export function parseInvite(input,origin='https://ludo-studio-sentinel.tabisharaza.chatgpt.site'){
  if(typeof input!=='string'||input.length>2048)return null;
  const value=input.trim();
  const code=value.replace(/[\s-]/g,'').toUpperCase();
  if(/^[A-F0-9]{16}$/.test(code))return code;
  try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||![origin,'https://ludo-studio-sentinel.tabisharaza.chatgpt.site'].includes(url.origin)||url.username||url.password||url.pathname!=='/'||url.search)return null;return /^#room=([A-F0-9]{16})$/i.exec(url.hash)?.[1].toUpperCase()??null;}catch{return null;}
}
