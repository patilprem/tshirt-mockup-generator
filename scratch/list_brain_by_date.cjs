const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079';

const files = fs.readdirSync(brainDir).map(file => {
  const stat = fs.statSync(path.join(brainDir, file));
  return {
    name: file,
    mtime: stat.mtime,
    size: stat.size
  };
});

files.sort((a, b) => a.mtime - b.mtime);

files.forEach(f => {
  if (f.name.endsWith('.png') || f.name.endsWith('.jpg')) {
    console.log(`${f.mtime.toISOString()} - ${f.name} (${f.size} bytes)`);
  }
});
