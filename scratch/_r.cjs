const fs=require('fs'), path=require('path');
const {chromium}=require('playwright');
const DIST='/home/user/tshirt-mockup-generator/scratch/artifacts/dist';
const OUT=process.env.OUT; fs.mkdirSync(OUT,{recursive:true});
function cp(){const b='/opt/pw-browsers';for(const d of fs.readdirSync(b).filter(x=>/^chromium-\d+$/.test(x)).sort().reverse()){const p=path.join(b,d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}
function wrap(f){const o=path.join(OUT,path.basename(f));fs.writeFileSync(o,`<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(f,'utf8')}</body></html>`);return 'file://'+o;}
(async()=>{
const br=await chromium.launch({executablePath:cp()});
const pg=await br.newPage({viewport:{width:1280,height:1000}});
pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto(wrap(path.join(DIST,'try-colors.html')));
const b64=fs.readFileSync(process.argv[2]).toString('base64');
const r=await pg.evaluate(async({b64})=>{
  const img=new Image();
  await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src='data:image/png;base64,'+b64;});
  const a=analyze(img); const W=a.W,H=a.H,N=W*H;
  const lutT=relightLut([255,255,255],a), lutV=relightLut(a.violetBase,a);
  const d=new Uint8ClampedArray(a.photoData);
  for(let i=0;i<N;i++){const wv=a.wArr[i]; if(!wv) continue;
    const ww=wv/255, cl=a.ownArr[i]/255, sb=a.shade[i]*3, o=i*4;
    d[o]+=ww*(lutT[sb]-cl*d[o]-(1-cl)*lutV[sb]);
    d[o+1]+=ww*(lutT[sb+1]-cl*d[o+1]-(1-cl)*lutV[sb+1]);
    d[o+2]+=ww*(lutT[sb+2]-cl*d[o+2]-(1-cl)*lutV[sb+2]);}
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const im=c.getContext('2d').createImageData(W,H);im.data.set(d);c.getContext('2d').putImageData(im,0,0);
  return {W,H,png:c.toDataURL('image/png')};
},{b64});
fs.writeFileSync(path.join(OUT,'white.png'),Buffer.from(r.png.split(',')[1],'base64'));
console.log(r.W+'x'+r.H);
await br.close();
})();
