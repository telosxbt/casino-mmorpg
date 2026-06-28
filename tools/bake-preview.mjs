// Headless bake of the MV casino map (same algorithm as the browser renderer)
// so we can SEE the furniture and verify interactable placement / collision.
import { createCanvas, loadImage } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const mvData = resolve(root, 'casinoluxury/examples/data');
const mvImg = resolve(root, 'casinoluxury/examples/img/tilesets');

const TILE = 48;
const A5=1536,A1=2048,A2=2816,A3=4352,A4=5888,MAX=8192;
const vis=id=>id>0&&id<MAX, auto=id=>id>=A1, kind=id=>Math.floor((id-A1)/48), shape=id=>(id-A1)%48;
const isA1=id=>id>=A1&&id<A2,isA2=id=>id>=A2&&id<A3,isA3=id=>id>=A3&&id<A4,isA4=id=>id>=A4&&id<MAX,isA5=id=>id>=A5&&id<A1;
const FLOOR=[[[2,4],[1,4],[2,3],[1,3]],[[2,0],[1,4],[2,3],[1,3]],[[2,4],[3,0],[2,3],[1,3]],[[2,0],[3,0],[2,3],[1,3]],[[2,4],[1,4],[2,3],[3,1]],[[2,0],[1,4],[2,3],[3,1]],[[2,4],[3,0],[2,3],[3,1]],[[2,0],[3,0],[2,3],[3,1]],[[2,4],[1,4],[2,1],[1,3]],[[2,0],[1,4],[2,1],[1,3]],[[2,4],[3,0],[2,1],[1,3]],[[2,0],[3,0],[2,1],[1,3]],[[2,4],[1,4],[2,1],[3,1]],[[2,0],[1,4],[2,1],[3,1]],[[2,4],[3,0],[2,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,4],[1,4],[0,3],[1,3]],[[0,4],[3,0],[0,3],[1,3]],[[0,4],[1,4],[0,3],[3,1]],[[0,4],[3,0],[0,3],[3,1]],[[2,2],[1,2],[2,3],[1,3]],[[2,2],[1,2],[2,3],[3,1]],[[2,2],[1,2],[2,1],[1,3]],[[2,2],[1,2],[2,1],[3,1]],[[2,4],[3,4],[2,3],[3,3]],[[2,4],[3,4],[2,1],[3,3]],[[2,0],[3,4],[2,3],[3,3]],[[2,0],[3,4],[2,1],[3,3]],[[2,4],[1,4],[2,5],[1,5]],[[2,0],[1,4],[2,5],[1,5]],[[2,4],[3,0],[2,5],[1,5]],[[2,0],[3,0],[2,5],[1,5]],[[0,4],[3,4],[0,3],[3,3]],[[2,2],[1,2],[2,5],[1,5]],[[0,2],[1,2],[0,3],[1,3]],[[0,2],[1,2],[0,3],[3,1]],[[2,2],[3,2],[2,3],[3,3]],[[2,2],[3,2],[2,1],[3,3]],[[2,4],[3,4],[2,5],[3,5]],[[2,0],[3,4],[2,5],[3,5]],[[0,4],[1,4],[0,5],[1,5]],[[0,4],[3,0],[0,5],[1,5]],[[0,2],[3,2],[0,3],[3,3]],[[0,2],[1,2],[0,5],[1,5]],[[0,4],[3,4],[0,5],[3,5]],[[2,2],[3,2],[2,5],[3,5]],[[0,2],[3,2],[0,5],[3,5]],[[0,0],[1,0],[0,1],[1,1]]];
const WALL=[[[2,2],[1,2],[2,1],[1,1]],[[0,2],[1,2],[0,1],[1,1]],[[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[2,2],[3,2],[2,1],[3,1]],[[0,2],[3,2],[0,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],[[2,2],[1,2],[2,3],[1,3]],[[0,2],[1,2],[0,3],[1,3]],[[2,0],[1,0],[2,3],[1,3]],[[0,0],[1,0],[0,3],[1,3]],[[2,2],[3,2],[2,3],[3,3]],[[0,2],[3,2],[0,3],[3,3]],[[2,0],[3,0],[2,3],[3,3]],[[0,0],[3,0],[0,3],[3,3]]];
const WF=[[[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]]];

const map=JSON.parse(readFileSync(resolve(mvData,'Map001.json'),'utf8'));
const ts=JSON.parse(readFileSync(resolve(mvData,'Tilesets.json'),'utf8'));
const flags=ts[map.tilesetId].flags;
const {width:W,height:H,data}=map;
const names=ts[map.tilesetId].tilesetNames;
const bmp={};
for(const [i,n] of [[0,'A1'],[1,'A2'],[3,'A4'],[5,'B'],[6,'C']]){
  const f=names[i]; if(f) bmp[i]=await loadImage(resolve(mvImg,`${f}.png`));
}
const cv=createCanvas(W*TILE,H*TILE); const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
const read=(x,y,z)=>data[(z*H+y)*W+x]||0;
function drawNormal(id,dx,dy){const set=isA5(id)?4:5+Math.floor(id/256);const s=bmp[set];if(!s)return;const sx=((Math.floor(id/128)%2)*8+id%8)*TILE;const sy=(Math.floor(id%256/8)%16)*TILE;ctx.drawImage(s,sx,sy,TILE,TILE,dx,dy,TILE,TILE);}
function drawAuto(id,dx,dy){let table=FLOOR;const k=kind(id),sh=shape(id),tx=k%8,ty=Math.floor(k/8);let bx=0,by=0,set=0,tbl=false;
 if(isA1(id)){set=0;if(k===0){bx=0;by=0}else if(k===1){bx=0;by=3}else if(k===2){bx=6;by=0}else if(k===3){bx=6;by=3}else{bx=Math.floor(tx/4)*8;by=ty*6+(Math.floor(tx/2)%2)*3;if(k%2!==0){bx+=6;table=WF}}}
 else if(isA2(id)){set=1;bx=tx*2;by=(ty-2)*3;tbl=!!(flags[id]&0x80)}
 else if(isA3(id)){set=2;bx=tx*2;by=(ty-6)*2;table=WALL}
 else if(isA4(id)){set=3;bx=tx*2;by=Math.floor((ty-10)*2.5+(ty%2===1?0.5:0));if(ty%2===1)table=WALL}
 const t=table[sh],s=bmp[set];if(!t||!s)return;const w1=TILE/2,h1=TILE/2;
 for(let i=0;i<4;i++){const qx=t[i][0],qy=t[i][1];const sx=(bx*2+qx)*w1,sy=(by*2+qy)*h1;const ddx=dx+(i%2)*w1;let ddy=dy+Math.floor(i/2)*h1;
   if(tbl&&(qy===1||qy===5)){const qx2=qy===1?[0,3,2,1][qx]:qx;const sx2=(bx*2+qx2)*w1,sy2=(by*2+3)*h1;ctx.drawImage(s,sx2,sy2,w1,h1,ddx,ddy,w1,h1);ddy+=h1/2;ctx.drawImage(s,sx,sy,w1,h1/2,ddx,ddy,w1,h1/2)}else ctx.drawImage(s,sx,sy,w1,h1,ddx,ddy,w1,h1)}}
for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(let z=0;z<4;z++){const id=read(x,y,z);if(!vis(id))continue;if(auto(id))drawAuto(id,x*TILE,y*TILE);else drawNormal(id,x*TILE,y*TILE);}
writeFileSync(resolve(root,'tools/_preview_clean.png'),cv.toBuffer('image/png'));

// Overlay collision (red) + tile grid coords every 5
const casino=JSON.parse(readFileSync(resolve(root,'backend/src/world/data/casino-map.json'),'utf8'));
ctx.font='10px sans-serif';
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(casino.collision[y*W+x]){ctx.fillStyle='rgba(255,0,0,0.35)';ctx.fillRect(x*TILE,y*TILE,TILE,TILE);}}
ctx.strokeStyle='rgba(255,255,255,0.15)';
for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*TILE,0);ctx.lineTo(x*TILE,H*TILE);ctx.stroke();}
for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*TILE);ctx.lineTo(W*TILE,y*TILE);ctx.stroke();}
for(const o of casino.interactables){ctx.fillStyle='cyan';ctx.beginPath();ctx.arc(o.x*TILE+24,o.y*TILE+24,14,0,7);ctx.fill();ctx.fillStyle='#000';ctx.fillText(o.id,o.x*TILE+4,o.y*TILE+28);}
// coord ruler
ctx.fillStyle='yellow';for(let x=0;x<W;x+=5)ctx.fillText(''+x,x*TILE+2,10);for(let y=0;y<H;y+=5)ctx.fillText(''+y,2,y*TILE+20);
writeFileSync(resolve(root,'tools/_preview_overlay.png'),cv.toBuffer('image/png'));
console.log('wrote tools/_preview_clean.png and _preview_overlay.png',W,'x',H);
