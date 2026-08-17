// How much MODELLING does each garment carry? The shade map is illumination
// relative to the fabric's diffuse white point, so its spread inside the
// garment is how much light-and-shadow the recolour has to work with. A narrow
// spread is a flat garment: correct, but it reads as a shape rather than cloth,
// and that shows up worst on a dark colour where there is little else to see.
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const DIR='/home/user/tshirt-mockup-generator/public/assets/on-model';
(async()=>{
  const metas=JSON.parse(fs.readFileSync(path.join(DIR,'templates.json'),'utf8'));
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const rows=[];
  for(const m of metas){
    const b64=f=>fs.readFileSync(path.join(DIR,f)).toString('base64');
    const r=await p.evaluate(async({shade,weight})=>{
      const ld=u=>new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.src=u;});
      const si=await ld('data:image/jpeg;base64,'+shade), wi=await ld('data:image/png;base64,'+weight);
      const W=wi.width,H=wi.height;
      const c=document.createElement('canvas');c.width=W;c.height=H;
      const x=c.getContext('2d',{willReadFrequently:true});
      x.drawImage(si,0,0,W,H);const sd=x.getImageData(0,0,W,H).data;
      x.clearRect(0,0,W,H);x.drawImage(wi,0,0,W,H);const wd=x.getImageData(0,0,W,H).data;
      const v=[];
      for(let i=0;i<W*H;i++) if(wd[i*4]>240) v.push(sd[i*4]);
      v.sort((a,b)=>a-b);
      if(v.length<500) return null;
      const q=f=>v[Math.floor(f*(v.length-1))];
      return {n:v.length, p5:q(0.05), p50:q(0.5), p95:q(0.95), spread:q(0.95)-q(0.05)};
    },{shade:b64(`${m.id}-shade.jpg`),weight:b64(`${m.id}-weight.png`)});
    if(r) rows.push([m.label, r.spread, r.p5, r.p50, r.p95]);
  }
  rows.sort((a,b)=>a[1]-b[1]);
  console.log('garment modelling — spread of the shade map inside solid fabric (p95-p5)\n');
  for(const [l,s,a,med,z] of rows)
    console.log(`  ${String(s).padStart(3)}  ${'█'.repeat(Math.round(s/3))}  ${l}  (${a}..${med}..${z})`);
  await b.close();})();
