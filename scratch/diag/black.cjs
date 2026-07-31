const { chromium } = require('playwright');
const fs = require('fs');
const MANI = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json','utf8'));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport:{width:1400,height:1400} });
  for (const id of ['plaster-f','window-f']) {
    const t=MANI.find(x=>x.id===id);
    const enc={};
    for(const k of ['plate','matte','shade']){const f='public'+t[k];
      enc[k]='data:image/'+(f.endsWith('.png')?'png':'jpeg')+';base64,'+fs.readFileSync(f).toString('base64');}
    const u=await p.evaluate(async({enc,t,hex})=>{
      const li=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=s;});
      const [plate,mI,sI]=await Promise.all([li(enc.plate),li(enc.matte),li(enc.shade)]);
      const w=t.width,h=t.height,n=w*h;
      const sc=document.createElement('canvas');sc.width=w;sc.height=h;
      const sx=sc.getContext('2d',{willReadFrequently:true});
      sx.drawImage(mI,0,0,w,h);const mR=sx.getImageData(0,0,w,h).data;
      sx.clearRect(0,0,w,h);sx.drawImage(sI,0,0,w,h);const sR=sx.getImageData(0,0,w,h).data;
      const matte=new Uint8ClampedArray(n),shade=new Uint8ClampedArray(n);
      for(let i=0;i<n;i++){matte[i]=mR[i*4];shade[i]=sR[i*4];}
      const tr=parseInt(hex.slice(1,3),16),tg=parseInt(hex.slice(3,5),16),tb=parseInt(hex.slice(5,7),16);
      const tL=(tr+tg+tb)/765,RM=t.relMax||1.45,GA=1-0.55*tL,TI=0.35*tL,SP=0.28;
      const [ar,ag,ab]=t.ambientTint;
      const out=document.createElement('canvas');out.width=w;out.height=h;
      const ox=out.getContext('2d');ox.drawImage(plate,0,0,w,h);
      const gc=document.createElement('canvas');gc.width=w;gc.height=h;
      const gx=gc.getContext('2d');const gi=gx.createImageData(w,h);const d=gi.data;
      for(let i=0;i<n;i++){
        const a=matte[i],o=i*4;
        if(a===0){d[o+3]=0;continue;}
        const rel=(shade[i]/255)*RM,diff=Math.pow(Math.min(rel,1),GA),wt=(1-diff)*TI;
        let R=tr*diff*(1-wt+wt*ar),G=tg*diff*(1-wt+wt*ag),B=tb*diff*(1-wt+wt*ab);
        if(rel>1){const s2=Math.min(1,(rel-1)/(RM-1))*SP;R+=(255-R)*s2;G+=(255-G)*s2;B+=(255-B)*s2;}
        d[o]=Math.min(255,R);d[o+1]=Math.min(255,G);d[o+2]=Math.min(255,B);d[o+3]=a;
      }
      gx.putImageData(gi,0,0);ox.drawImage(gc,0,0);
      return out.toDataURL('image/jpeg',0.95);
    },{enc,t,hex:'#141416'});
    fs.writeFileSync(`scratch/diag/black-${id}.jpg`,Buffer.from(u.split(',')[1],'base64'));
  }
  await b.close();
})();
