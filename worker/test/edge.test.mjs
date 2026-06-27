import * as M from '../src/mahjongCore.js';
const { createGame, getLegalActions, pendingDeciders, applyAction, botChooseAction, tileIndex, validateConservation } = M;
const T = (s,r)=>tileIndex(s,r); const DOT=0,BAM=1,CHA=2;
let pass=0,fail=0; const F=[];
const ok=(c,m)=>{ if(c)pass++; else {fail++;F.push(m);} };
function counts(list){ const c=new Array(27).fill(0); for(const t of list)c[t]++; return c; }
function freshSkeleton(mode='bloody'){ const s=createGame({seed:1, config:M.makeConfig({mode})}); return s; }

/* ---- ROB THE KONG (§6.9, §22.9) ---- */
{
  const s=freshSkeleton();
  s.phase='ACTIVE_TURN'; s.active=0; s.firstDiscardDone=true;
  s.turnFlags={needsDraw:false,drewFromKong:false,lastDrawn:T(BAM,5),firstTurn:false,afterPung:false,lastTileExhausted:false};
  for(const p of s.players){ p.missingSuit=DOT; p.melds=[]; p.hasWon=false; }
  // P0: exposed pung of BAM5 + holds the 4th BAM5
  s.players[0].melds=[{type:'PUNG',tile:T(BAM,5),source:1,concealed:false}];
  s.players[0].concealed=counts([T(BAM,5), T(CHA,1),T(CHA,2),T(CHA,3),T(CHA,4),T(CHA,5),T(CHA,6),T(CHA,7),T(CHA,8),T(CHA,9),T(BAM,1)]);
  // P1: tenpai waiting on BAM5
  s.players[1].concealed=counts([T(BAM,3),T(BAM,4), T(CHA,1),T(CHA,2),T(CHA,3), T(CHA,4),T(CHA,5),T(CHA,6), T(CHA,7),T(CHA,8),T(CHA,9), T(BAM,9),T(BAM,9)]);
  // P2,P3 junk (cannot win on BAM5)
  s.players[2].concealed=counts([T(CHA,1),T(CHA,1),T(CHA,3),T(CHA,5),T(CHA,7),T(BAM,2),T(BAM,2),T(BAM,4),T(BAM,6),T(BAM,8),T(CHA,9),T(CHA,8),T(CHA,6)]);
  s.players[3].concealed=counts([T(CHA,2),T(CHA,2),T(CHA,4),T(CHA,6),T(CHA,8),T(BAM,1),T(BAM,1),T(BAM,3),T(BAM,6),T(BAM,7),T(CHA,7),T(CHA,5),T(CHA,3)]);
  const acts0=getLegalActions(s,0);
  ok(acts0.some(a=>a.type==='DeclareAddedKong'&&a.tile===T(BAM,5)),'rob: added kong offered to P0');
  const r1=applyAction(s,0,{type:'DeclareAddedKong',tile:T(BAM,5)});
  ok(r1.ok,'rob: added kong applied');
  ok(s.phase==='AWAITING_ROB_KONG_REACTIONS','rob: entered rob window');
  const acts1=getLegalActions(s,1);
  ok(acts1.some(a=>a.type==='RobKong'&&a.tile===T(BAM,5)),'rob: P1 offered RobKong');
  ok(!getLegalActions(s,2).some(a=>a.type==='RobKong'),'rob: P2 cannot rob (not tenpai on tile)');
  const r2=applyAction(s,1,{type:'RobKong',tile:T(BAM,5)});
  ok(r2.ok && s.players[1].hasWon,'rob: P1 wins by robbing the kong');
  ok(s.players[1].winRecords[0].winType==='ROB_KONG','rob: recorded as ROB_KONG');
  ok(s.players[1].winRecords[0].deltas[0]<0,'rob: declarer P0 pays the winner');
  ok(s.players[0].melds[0].type==='PUNG','rob: cancelled kong stays a pung');
  // CRITICAL regression: declarer must return to 13 effective tiles (concealed + 3*pung), not 14
  { const eff=s.players[0].concealed.reduce((a,b)=>a+b,0)+s.players[0].melds.reduce((a,m)=>a+(m.type==='PUNG'?3:4),0);
    ok(eff===13,'rob: declarer back to 13 effective tiles (not stuck at 14) — got '+eff); }
  { const phys=new Array(27).fill(0); phys[T(BAM,5)]=0;
    for(const p of s.players){ for(let t=0;t<27;t++)phys[t]+=p.concealed[t]; for(const m of p.melds)phys[m.tile]+=(m.type==='PUNG'?3:4); for(const d of p.discards)phys[d]++; }
    ok(phys[T(BAM,5)]===4,'rob: all 4 copies of the robbed tile still accounted for — got '+phys[T(BAM,5)]); }
}

/* ---- MULTIPLE WINNERS ON ONE DISCARD (§10.1, §22.8) ---- */
{
  const s=freshSkeleton();
  s.phase='ACTIVE_TURN'; s.active=0; s.firstDiscardDone=true;
  s.turnFlags={needsDraw:false,drewFromKong:false,lastDrawn:T(CHA,1),firstTurn:false,afterPung:false,lastTileExhausted:false};
  for(const p of s.players){ p.missingSuit=DOT; p.melds=[]; }
  // P0 will discard BAM5; P1 and P2 both tenpai on BAM5
  s.players[0].concealed=counts([T(BAM,5), T(CHA,1),T(CHA,1),T(CHA,2),T(CHA,3),T(CHA,4),T(CHA,5),T(CHA,6),T(CHA,7),T(CHA,8),T(CHA,9),T(BAM,9),T(BAM,9),T(BAM,8)]);
  const wait=[T(BAM,3),T(BAM,4), T(CHA,1),T(CHA,2),T(CHA,3), T(CHA,4),T(CHA,5),T(CHA,6), T(CHA,7),T(CHA,8),T(CHA,9), T(BAM,9),T(BAM,9)];
  s.players[1].concealed=counts(wait);
  s.players[2].concealed=counts(wait);
  s.players[3].concealed=counts([T(CHA,2),T(CHA,2),T(CHA,4),T(CHA,6),T(CHA,8),T(BAM,1),T(BAM,1),T(BAM,2),T(BAM,4),T(BAM,6),T(CHA,7),T(CHA,5),T(CHA,3)]);
  applyAction(s,0,{type:'Discard',tile:T(BAM,5)});
  ok(s.phase==='AWAITING_DISCARD_REACTIONS','multiwin: reaction window opened');
  ok(getLegalActions(s,1).some(a=>a.type==='DeclareWinFromDiscard'),'multiwin: P1 can win');
  ok(getLegalActions(s,2).some(a=>a.type==='DeclareWinFromDiscard'),'multiwin: P2 can win');
  applyAction(s,1,{type:'DeclareWinFromDiscard',tile:T(BAM,5)});
  applyAction(s,2,{type:'DeclareWinFromDiscard',tile:T(BAM,5)});
  ok(s.players[1].hasWon && s.players[2].hasWon,'multiwin: both P1 and P2 win on the same discard');
  ok(s.players[0].score<0,'multiwin: discarder P0 pays both');
  ok(s.players[1].concealed[T(BAM,5)]===0 && s.players[2].concealed[T(BAM,5)]===0,'multiwin: winning tile scored virtually (not persisted into either winner hand)');
}

/* ---- SINGLE MODE ends at first win ---- */
{
  let games=0, okEnds=0;
  for(let seed=1;seed<=40;seed++){
    const s=createGame({seed, config:M.makeConfig({mode:'single'}), seats:[{isBot:true,difficulty:'hard'},{isBot:true},{isBot:true},{isBot:true}]});
    let g=0, endedAtWin=true; while(s.phase!=='HAND_ENDED'&&g++<3000){ const d=pendingDeciders(s); if(!d.length)break; applyAction(s,d[0],botChooseAction(s,d[0])); if(s.winnersThisHand.length>0 && s.phase!=='HAND_ENDED') endedAtWin=false; }
    games++;
    if(endedAtWin) okEnds++;
  }
  ok(okEnds===games, `single mode: hand ends immediately at the first win (no continued play) (${okEnds}/${games})`);
}

/* ---- HEAVENLY HAND (dealer initial 14 is a win) ---- */
{
  const s=freshSkeleton();
  s.phase='ACTIVE_TURN'; s.active=0; s.dealer=0; s.firstDiscardDone=false;
  s.turnFlags={needsDraw:false,drewFromKong:false,lastDrawn:null,firstTurn:true,afterPung:false,lastTileExhausted:false};
  for(const p of s.players){ p.missingSuit=DOT; p.melds=[]; }
  s.players[0].concealed=counts([T(BAM,1),T(BAM,2),T(BAM,3), T(BAM,4),T(BAM,5),T(BAM,6), T(BAM,7),T(BAM,8),T(BAM,9), T(CHA,1),T(CHA,2),T(CHA,3), T(CHA,9),T(CHA,9)]);
  const acts=getLegalActions(s,0);
  ok(acts.some(a=>a.type==='DeclareSelfDrawWin'),'heavenly: dealer can self-draw-win on opening hand');
  applyAction(s,0,{type:'DeclareSelfDrawWin'});
  const rec=s.players[0].winRecords[0];
  ok(rec && rec.fanAwards.some(f=>f.name==='Heavenly Hand'),'heavenly: scored as Heavenly Hand');
}

console.log(`\nEdge cases: ${pass} passed, ${fail} failed.`);
if(F.length) console.log(' - '+F.join('\n - '));
