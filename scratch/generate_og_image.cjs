const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const logoPath = 'C:/Users/Hello/.gemini/antigravity/brain/17679472-da3c-4030-8378-492eb539a079/media__1782060965595.png';
  const destPath = path.join(__dirname, '..', 'public', 'og-image.png');

  if (!fs.existsSync(logoPath)) {
    console.error(`Error: Source logo file not found at ${logoPath}`);
    process.exit(1);
  }

  console.log(`Reading source logo for OG Image: ${logoPath}`);
  const logoBuffer = fs.readFileSync(logoPath);
  const logoBase64 = logoBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${logoBase64}`;

  console.log('Launching browser to render OG image...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to the standard OG size
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto('about:blank');

  // Inject Outfit and Inter fonts via HTML head
  await page.evaluate(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Outfit:wght@700;800&display=swap';
    document.head.appendChild(link);
  });

  // Wait a moment for fonts to load
  await page.waitForTimeout(1000);

  const ogImageBase64 = await page.evaluate(async (logoUri) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = logoUri;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');

        // 1. Background: Sleek Dark themed gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
        bgGrad.addColorStop(0, '#0b1329'); // Dark slate blue
        bgGrad.addColorStop(0.5, '#070b16'); // Deep dark
        bgGrad.addColorStop(1, '#05070f'); // Blackish blue
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1200, 630);

        // 2. Decorative Glowing Blobs (Cyan-Blue Glows)
        ctx.globalCompositeOperation = 'screen';
        
        // Glow 1: Top Right (Electric Blue)
        const glow1 = ctx.createRadialGradient(1000, 100, 50, 1000, 100, 400);
        glow1.addColorStop(0, 'rgba(56, 139, 253, 0.15)');
        glow1.addColorStop(1, 'rgba(56, 139, 253, 0)');
        ctx.fillStyle = glow1;
        ctx.beginPath();
        ctx.arc(1000, 100, 400, 0, Math.PI * 2);
        ctx.fill();

        // Glow 2: Bottom Left (Vibrant Sky Cyan)
        const glow2 = ctx.createRadialGradient(200, 500, 50, 200, 500, 400);
        glow2.addColorStop(0, 'rgba(0, 180, 230, 0.18)');
        glow2.addColorStop(1, 'rgba(0, 180, 230, 0)');
        ctx.fillStyle = glow2;
        ctx.beginPath();
        ctx.arc(200, 500, 400, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';

        // 3. Draw Brand Logo with shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 180, 230, 0.45)';
        ctx.shadowBlur = 45;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Draw the squircle logo at (120, 175) with size 280x280
        ctx.drawImage(img, 120, 175, 280, 280);
        ctx.restore();

        // 4. Draw Typography (Headline, Subheadline)
        // Set up fonts
        ctx.textBaseline = 'top';

        // Title: Mockup Studio
        ctx.font = '800 80px Outfit, Inter, sans-serif';
        const titleText = 'Mockup Studio';
        
        // Linear gradient for text (White to slight Cyan-grey)
        const textGrad = ctx.createLinearGradient(480, 180, 1000, 180);
        textGrad.addColorStop(0, '#ffffff');
        textGrad.addColorStop(1, '#aedef4');
        ctx.fillStyle = textGrad;
        ctx.fillText(titleText, 480, 180);

        // Subtitle: Free T-Shirt Mockup Generator
        ctx.font = '700 36px Outfit, Inter, sans-serif';
        ctx.fillStyle = '#00b4e6'; // Sky Cyan accent
        ctx.fillText('Free T-Shirt Mockup Generator', 480, 285);

        // Description
        ctx.font = '400 24px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8'; // Slate secondary text
        ctx.fillText('Create photo-realistic apparel mockups in-browser.', 480, 345);
        ctx.fillText('Automatic 3D fabric fold and highlight blending.', 480, 385);

        // 5. Feature Badges (Pills)
        const badges = ['No Signup', 'No Watermark', '8 Garment Styles', 'High-Res PNG'];
        let currentX = 480;
        const badgeY = 450;

        ctx.font = '600 18px Inter, sans-serif';

        badges.forEach((badge) => {
          const textWidth = ctx.measureText(badge).width;
          const paddingX = 18;
          const paddingY = 8;
          const badgeWidth = textWidth + paddingX * 2;
          const badgeHeight = 24 + paddingY * 2;

          // Draw pill background
          ctx.fillStyle = 'rgba(15, 23, 42, 0.6)'; // Dark slate fill
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)'; // Sky cyan border outline
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(currentX, badgeY, badgeWidth, badgeHeight, 20);
          ctx.fill();
          ctx.stroke();

          // Draw pill text
          ctx.fillStyle = '#e2e8f0'; // Light slate text
          ctx.fillText(badge, currentX + paddingX, badgeY + paddingY);

          currentX += badgeWidth + 16; // Add margin to next badge
        });

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        resolve(null);
      };
    });
  }, dataUri);

  await browser.close();

  if (ogImageBase64) {
    const base64Data = ogImageBase64.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
    console.log(`Successfully generated and saved OG Image to: ${destPath}`);
  } else {
    console.error('Failed to generate OG image.');
    process.exit(1);
  }
})();
