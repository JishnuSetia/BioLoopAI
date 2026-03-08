/**
 * Shared Python runner for BioLoop AI services.
 */
const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');

const PYTHON_DIR = path.join(__dirname, '..', '..', 'python');

function runPython(scriptName, inputJson) {
  return new Promise((resolve, reject) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(py, [scriptName], {
      cwd: PYTHON_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OLLAMA_HOST: config.ollamaHost },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python exited ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Invalid JSON from Python: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(JSON.stringify(inputJson || {}));
    child.stdin.end();
  });
}

module.exports = { runPython };
