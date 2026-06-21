const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079';
const files = [
  'media__1782046958833.png',
  'media__1782046958925.png',
  'media__1782046958941.jpg',
  'media__1782046959059.png',
  'media__1782046959113.jpg'
];

files.forEach(file => {
  const filePath = path.join(brainDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`${file} does not exist`);
    return;
  }
  const buffer = fs.readFileSync(filePath);
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  console.log(`${file}: size=${buffer.length} bytes, format=${isPng ? 'PNG' : isJpg ? 'JPG' : 'Unknown'}`);
});
