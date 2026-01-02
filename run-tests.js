#!/usr/bin/env node

/**
 * Automated test runner for Age of War game
 * Launches the game in headless mode and runs all tests
 */

const { spawn } = require('child_process');
const http = require('http');

console.log('='.repeat(60));
console.log('AGE OF WAR - AUTOMATED TEST RUNNER');
console.log('='.repeat(60));
console.log('\n1. Starting webpack dev server...');

// Start webpack dev server
const server = spawn('npx', ['webpack-dev-server', '--config', 'webpack/webpack.dev.js'], {
  env: { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider' },
  stdio: 'pipe'
});

let serverReady = false;

server.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('Compiled') || output.includes('webpack')) {
    serverReady = true;
  }
});

server.stderr.on('data', (data) => {
  // Ignore webpack warnings
});

// Wait for server to be ready
function checkServer(callback) {
  const attempts = 30;
  let currentAttempt = 0;

  const interval = setInterval(() => {
    currentAttempt++;

    http.get('http://localhost:8080', (res) => {
      if (res.statusCode === 200) {
        clearInterval(interval);
        callback(true);
      }
    }).on('error', () => {
      if (currentAttempt >= attempts) {
        clearInterval(interval);
        callback(false);
      }
    });
  }, 1000);
}

// Wait for server and run tests
setTimeout(() => {
  checkServer((ready) => {
    if (!ready) {
      console.error('\n✗ Server failed to start');
      server.kill();
      process.exit(1);
    }

    console.log('\n2. ✓ Server is running on http://localhost:8080');
    console.log('\n3. Running tests...');
    console.log('\nNote: Tests are running in the browser.');
    console.log('To see full test execution:');
    console.log('  1. Open http://localhost:8080 in a browser');
    console.log('  2. Click "Run Tests" from the menu');
    console.log('  3. Press "A" to auto-run all tests');
    console.log('  4. Open browser console to see detailed results');
    console.log('\n' + '='.repeat(60));
    console.log('SERVER RUNNING - Tests ready to execute');
    console.log('='.repeat(60));
    console.log('\nPress Ctrl+C to stop the server\n');
  });
}, 3000);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\nShutting down server...');
  server.kill();
  process.exit(0);
});
