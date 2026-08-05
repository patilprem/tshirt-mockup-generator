// Measures the flat-lay hero's behaviour off the canvas rather than off its
// state: snapshot, act, diff. A control that changes a variable but not the
// pixels is exactly the failure this is here to catch — the hero's colour
// swatches once did precisely that, and read as correct in source the whole
// time.
//
// Needs the dev server: npm run dev, then node test_hero_flatlay.cjs
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE_URL || 'http://localhost:4321';
let bad = 0;
const fail = m => { bad++; console.log('  FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);

// Count of pixels differing beyond a threshold between two snapshots.
const shot = p => p.evaluate(() => {
  const c = document.getElementById('hs-canvas');
  return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data];
});
const diff = (a,b) => { let n=0; for (let i=0;i<a.length;i+=4) if (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>24) n++; return n; };

// Blue selection-chrome pixels inside a region of the canvas (artboard units).
const chromeIn = (p, x0,y0,x1,y1) => p.evaluate(([x0,y0,x1,y1]) => {
  const c = document.getElementById('hs-canvas');
  const k = c.width/1000;
  const X=Math.round(x0*k), Y=Math.round(y0*k), W=Math.round((x1-x0)*k), H=Math.round((y1-y0)*k);
  const d = c.getContext('2d').getImageData(X,Y,W,H).data;
  let n=0;
  for (let i=0;i<d.length;i+=4) { const r=d[i],g=d[i+1],b=d[i+2];
    if (b>150 && b>r+45 && g>r && g<b) n++; }
  return n;
}, [x0,y0,x1,y1]);

(async () => {
  const br = await chromium.launch({ headless:true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const p = await br.newPage({ viewport:{width:1440,height:900} });
  p.on('pageerror', e => fail('PAGE ERROR: ' + e.message));
  await p.goto(BASE + '/', { waitUntil:'networkidle' });
  await p.waitForFunction(() => document.getElementById('hero-studio')?.hasAttribute('data-ready'), null, {timeout:20000});
  await sleep(900);

  console.log('\n1. toggle to flat lay actually repaints');
  const onModelShot = await shot(p);
  await p.click('#hs-mode button[data-mode="flatlay"]');
  await p.waitForFunction(()=>!document.getElementById('hero-studio').hasAttribute('data-loading'), null, {timeout:90000});
  await sleep(1200);
  const flatShot = await shot(p);
  diff(onModelShot, flatShot) > 50000 ? ok('canvas repainted') : fail('canvas barely changed on toggle');

  console.log('\n2. controls start on the DESIGN, not on a prop');
  // design sits around 500,420; the plant is staged at 40..240
  const designChrome0 = await chromeIn(p, 330, 260, 670, 620);
  const plantChrome0  = await chromeIn(p, 10, 10, 300, 300);
  designChrome0 > 200 ? ok(`design chrome present (${designChrome0}px)`) : fail(`no design chrome (${designChrome0}px)`);
  plantChrome0 < 60 ? ok(`plant unselected (${plantChrome0}px)`) : fail(`plant already has chrome (${plantChrome0}px)`);

  console.log('\n3. a prop becomes selectable once clicked');
  const box = await p.evaluate(()=>{const r=document.getElementById('hs-canvas').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height};});
  const at = (x,y) => ({ x: box.l + box.w*(x/1000), y: box.t + box.h*(y/1000) });
  const pt = at(140,140);
  await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.up();
  await sleep(400);
  const plantChrome1  = await chromeIn(p, 10, 10, 300, 340);
  const designChrome1 = await chromeIn(p, 330, 260, 670, 620);
  plantChrome1 > 200 ? ok(`plant now has chrome (${plantChrome1}px)`) : fail(`clicking the plant did not select it (${plantChrome1}px)`);
  designChrome1 < designChrome0/3 ? ok('design chrome handed over') : fail(`design still selected too (${designChrome1}px)`);

  console.log('\n4. colour swatches actually recolour the flat-lay garment');
  const beforeCol = await shot(p);
  await p.click('#hs-swatches button[data-c="#f4f4f4"]'); await sleep(700);
  const afterCol = await shot(p);
  const dc = diff(beforeCol, afterCol);
  dc > 20000 ? ok(`shirt recoloured (${dc}px changed)`) : fail(`colour swatch changed almost nothing (${dc}px)`);

  console.log('\n5. garment picker actually swaps the silhouette');
  const beforeG = await shot(p);
  await p.click('#hs-tiles button[data-garment="tanktop"]');
  await p.waitForFunction(()=>!document.getElementById('hero-studio').hasAttribute('data-loading'), null, {timeout:60000});
  await sleep(1500);
  const afterG = await shot(p);
  const dg = diff(beforeG, afterG);
  dg > 20000 ? ok(`garment swapped (${dg}px changed)`) : fail(`garment picker changed almost nothing (${dg}px)`);

  console.log('\n6. the hat clears the picker column');
  const clr = await p.evaluate(()=>{
    const c=document.getElementById('hs-canvas'), t=document.getElementById('hs-tiles');
    const cr=c.getBoundingClientRect(), tr=t.getBoundingClientRect();
    // hat staged at x=550 w=330 -> right edge 880 artboard units
    return { hatRight: cr.left + cr.width*(880/1000), pickerLeft: tr.left };
  });
  clr.hatRight < clr.pickerLeft
    ? ok(`hat right edge ${clr.hatRight.toFixed(0)} < picker left ${clr.pickerLeft.toFixed(0)}`)
    : fail(`hat runs under the picker column (${clr.hatRight.toFixed(0)} >= ${clr.pickerLeft.toFixed(0)})`);

  console.log('\n7. toggling back to on model restores it');
  await p.click('#hs-mode button[data-mode="onmodel"]'); await sleep(1500);
  const backShot = await shot(p);
  diff(backShot, afterG) > 50000 ? ok('returned to on model') : fail('toggle back did not repaint');
  const sel = await p.evaluate(()=>[...document.querySelectorAll('#hs-mode button')].map(b=>b.getAttribute('aria-selected')));
  sel[0]==='true' && sel[1]==='false' ? ok('toggle state correct') : fail('toggle aria-selected wrong: '+sel);
  const tag = await p.evaluate(()=>document.getElementById('hs-tiles').children[0].tagName);
  tag==='IMG' ? ok('picker back to models') : fail('picker did not swap back: '+tag);

  await br.close();
  console.log(bad ? `\n${bad} failure(s)` : '\nflat-lay hero verified');
  process.exit(bad?1:0);
})();
