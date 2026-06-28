import { createCanvas, loadImage } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dir=dirname(fileURLToPath(import.meta.url));const root=resolve(__dir,'..');const TILE=48;
const casino=JSON.parse(readFileSync(resolve(root,'backend/src/world/data/casino-map.json'),'utf8'));
const W=casino.width,H=casino.height;
const base=await loadImage(resolve(root,'tools/_preview_clean.png'));
const cv=createCanvas(W*TILE,H*TILE);const ctx=cv.getContext('2d');ctx.drawImage(base,0,0);
ctx.strokeStyle='rgba(0,0,0,0.25)';for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*TILE,0);ctx.lineTo(x*TILE,H*TILE);ctx.stroke();}for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*TILE);ctx.lineTo(W*TILE,y*TILE);ctx.stroke();}
// markers
for(const o of casino.interactables){const cx=o.x*TILE+24,cy=o.y*TILE+24;ctx.fillStyle=o.type==='ROULETTE'?'rgba(255,60,60,0.95)':o.type==='BLACKJACK'?'rgba(60,255,120,0.95)':'rgba(80,200,255,0.95)';ctx.beginPath();ctx.arc(cx,cy,16,0,7);ctx.fill();ctx.fillStyle='#000';ctx.font='bold 14px sans-serif';ctx.fillText(o.id.replace(/[a-z-]/g,''),cx-4,cy+5);}
function crop(name,x0,x1){const w=(x1-x0)*TILE,h=H*TILE;const o=createCanvas(w*2,h*2);const oc=o.getContext('2d');oc.imageSmoothingEnabled=false;oc.scale(2,2);oc.drawImage(cv,x0*TILE,0,w,h,0,0,w,h);oc.fillStyle='yellow';oc.font='bold 11px sans-serif';for(let x=x0;x<x1;x++)oc.fillText(`${x}`,(x-x0)*TILE+2,11);oc.fillStyle='#00e5ff';for(let y=0;y<H;y++)oc.fillText(`${y}`,2,y*TILE+22);writeFileSync(resolve(root,`tools/_zoom_${name}.png`),o.toBuffer('image/png'));}
crop('left',0,16);crop('mid',16,40);crop('right',40,60);console.log('ok');
