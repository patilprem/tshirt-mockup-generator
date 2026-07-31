// Look for interior matte holes: pixels well inside the garment whose alpha is
// below full, where the inpainted (pale) plate would now show through.
const { chromium } = require('playwright');
const fs = require('fs');
const MANI = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json','utf8'));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport:{width:1400,height:1400} });
  for (const t of MANI) {
    const mb='data:image/png;base64,'+fs.readFileSync('public'+t.matte).toString('base64');
    const r = await p.evaluate(async ({mb,w,h})=>{
      const i=new Image(); await new Promise(r=>{i.onload=r;i.src=mb;});
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(i,0,0,w,h);
      const d=x.getImageData(0,0,w,h).data;
      const n=w*h;
      const a=new Uint8Array(n);
      for(let k=0;k<n;k++)a[k]=d[k*4];
      // interior = at least 12px from any alpha<32 pixel, via a coarse test
      const R=12;
      let holes=0, worst=255, wx=0, wy=0;
      for(let y=R;y<h-R;y++)for(let xx=R;xx<w-R;xx++){
        const k=y*w+xx;
        if(a[k]>=250) continue;
        // is it surrounded by solid garment in all 4 directions within R?
        let ok=true;
        for(const [dx,dy] of [[R,0],[-R,0],[0,R],[0,-R]]){
          if(a[(y+dy)*w+(xx+dx)]<250){ok=false;break;}
        }
        if(ok){ holes++; if(a[k]<worst){worst=a[k];wx=xx;wy=y;} }
      }
      return {holes, worst, wx, wy};
    },{mb,w:t.width,h:t.height});
    console.log(t.id.padEnd(14), 'interior sub-opaque px:', String(r.holes).padStart(6),
                ' worst alpha', r.worst, r.holes? `at (${r.wx},${r.wy})`:'');
  }
  await b.close();
})();
