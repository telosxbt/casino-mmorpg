import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';
const CW=427,CH=320;
const SKIN={default:null,light:[238,194,158],tan:[214,158,118],brown:[156,102,66],dark:[105,66,44],pale:[247,221,194]};
const HAIR={default:null,black:[34,32,38],blonde:[226,196,96],red:[158,64,42],gray:[178,178,184],white:[236,236,238],blue:[64,96,200],pink:[226,120,182]};
const SUIT={default:null,blue:[44,84,200],red:[156,36,46],green:[34,120,72],purple:[112,52,162],white:[228,228,234],gold:[200,160,52],teal:[32,150,160],burgundy:[112,30,52],navy:[26,42,92]};
function classify(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),lum=0.3*r+0.59*g+0.11*b,warm=r>=g&&g>=b;
 if(r>150&&g>120&&b<110&&r-b>70)return null;
 if(r>120&&r-g>50&&r-b>60)return 'suit';
 if(lum>175&&mx-mn<45)return null;
 if(warm&&r>120&&r-b>35&&lum>95)return 'skin';
 if(warm&&r-b>12&&lum>=45&&lum<130)return 'hair';
 if(lum<95&&mx-mn<60)return 'suit';return null;}
function recolor(img,look){const c=createCanvas(img.width,img.height),x=c.getContext('2d');x.drawImage(img,0,0);
 const want={skin:SKIN[look.skin],hair:HAIR[look.hair],suit:SUIT[look.suit]};
 const id=x.getImageData(0,0,c.width,c.height),d=id.data;
 for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const r=d[i],g=d[i+1],b=d[i+2];const reg=classify(r,g,b);if(!reg)continue;const t=want[reg];if(!t)continue;const lum=(0.3*r+0.59*g+0.11*b)/255;const k=Math.min(1.6,0.5+lum);d[i]=Math.min(255,t[0]*k);d[i+1]=Math.min(255,t[1]*k);d[i+2]=Math.min(255,t[2]*k);}
 x.putImageData(id,0,0);return c;}
const male=await loadImage('frontend/public/assets/characters/male.png');
const female=await loadImage('frontend/public/assets/characters/female.png');
const looksM=[{skin:'default',hair:'default',suit:'default'},{skin:'dark',hair:'black',suit:'red'},{skin:'light',hair:'blonde',suit:'blue'},{skin:'tan',hair:'gray',suit:'green'},{skin:'pale',hair:'pink',suit:'purple'},{skin:'brown',hair:'white',suit:'gold'}];
const looksF=[{skin:'default',hair:'default',suit:'default'},{skin:'light',hair:'black',suit:'blue'},{skin:'dark',hair:'blonde',suit:'purple'},{skin:'tan',hair:'red',suit:'teal'},{skin:'pale',hair:'white',suit:'navy'},{skin:'brown',hair:'pink',suit:'gold'}];
const CELL=120, COLS=6;
const out=createCanvas(CELL*COLS, CELL*2+30); const ox=out.getContext('2d'); ox.imageSmoothingEnabled=false;
ox.fillStyle='#15151f';ox.fillRect(0,0,out.width,out.height);
function row(looks,img,ry){looks.forEach((lk,i)=>{const rc=recolor(img,lk);ox.drawImage(rc,CW,0,CW,CH, i*CELL+10, ry, CELL-20, CELL-20*CH/CW*1.0);});}
row(looksM,male,5);row(looksF,female,CELL+15);
writeFileSync('tools/_looks.png',out.toBuffer('image/png'));console.log('ok');
