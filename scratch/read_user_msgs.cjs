const fs = require('fs');
const readline = require('readline');

const logPath = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\.system_generated\\logs\\transcript.jsonl';

const rl = readline.createInterface({
  input: fs.createReadStream(logPath),
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.source === 'USER_EXPLICIT') {
      console.log(`Step ${obj.step_index}: ${obj.content}`);
    }
  } catch (e) {
    // ignore
  }
});
