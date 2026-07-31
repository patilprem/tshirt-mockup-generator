// Outside the matte the plate must be byte-identical to the photo. Any drift
// there is background the inpaint corrupted.
const { chromium } = require('playwright');
const fs = require('fs');
const MANI = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json','utf8'));
const SRC = { 'plaster-f':'plaster-f','window-f':'window-f','gallery-f':'gallery-f',
              'livingroom-m':'livingroom-m','street-m':'street-m','park-m':'park-m' };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport:{width:1400,height:1400} });
  for (const t of MANI) {
    const orig='data:image/webp;base64,'+fs.readFileSync(`scratch/on-model-src/${SRC[t.id]}.webp`).toString('base64');
    const plate='data:image/jpeg;base64,'+fs.readFileSync('public'+t.plate).toString('base64');
    const matte='data:image/png;base64,'+fs.readFileSync('public'+t.matte).toString('base64');
    const r = await p.evaluate(async ({orig,plate,matte,w,h})=>{
      const li=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=s;});
      const [o,q,m]=await Promise.all([li(orig),li(plate),li(matte)]);
      const g=(im)=>{const c=document.createElement('canvas');c.width=w;c.height=h;
        const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingQuality='high';
        x.drawImage(im,0,0,w,h);return x.getImageData(0,0,w,h).data;};
      const O=g(o),Q=g(q),M=g(m);
      const n=w*h;
      let bad=0, worst=0, wx=0, wy=0, tot=0;
      const vis=document.createElement('canvas');vis.width=w;vis.height=h;
      const vx=vis.getContext('2d');const vi=vx.createImageData(w,h);
      for(let i=0;i<n;i++){
        const a=M[i*4];
        vi.data[i*4]=O[i*4];vi.data[i*4+1]=O[i*4+1];vi.data[i*4+2]=O[i*4+2];vi.data[i*4+3]=255;
        if(a>6) continue;           // only judge pixels the garment does not cover
        tot++;
        const d=Math.max(Math.abs(O[i*4]-Q[i*4]),Math.abs(O[i*4+1]-Q[i*4+1]),Math.abs(O[i*4+2]-Q[i*4+2]));
        if(d>18){ bad++; vi.data[i*4]=255;vi.data[i*4+1]=0;vi.data[i*4+2]=0;
          if(d>worst){worst=d;wx=i%w;wy=(i/w)|0;} }
      }
      vx.putImageData(vi,0,0);
      return {bad,tot,worst,wx,wy,pct:+(100*bad/tot).toFixed(3),url:vis.toDataURL('image/jpeg',0.9)};
    },{orig,plate,matte,w:t.width,h:t.height});
    console.log(t.id.padEnd(14),'corrupted bg px:',String(r.bad).padStart(7),
                `(${r.pct}%)  worst Δ${r.worst}`, r.bad?`at (${r.wx},${r.wy})`:'');
    if (r.bad>200) fs.writeFileSync(`scratch/diag/bgdiff-${t.id}.jpg`, Buffer.from(r.url.split(',')[1],'base64'));
  }
  await b.close();
})();
