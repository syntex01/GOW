const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const http = require('http');

async function runTests() {
  console.log('='.repeat(70));
  console.log('AGE OF WAR - RUNNING ALL TESTS');
  console.log('='.repeat(70));

  // Start webpack server
  console.log('\n1. Starting webpack dev server...');
  const server = spawn('npx', ['webpack-dev-server', '--config', 'webpack/webpack.dev.js'], {
    env: { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider' },
    stdio: 'pipe'
  });

  // Wait for server
  await new Promise(resolve => {
    const checkServer = setInterval(() => {
      http.get('http://localhost:8080', (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkServer);
          console.log('✓ Server ready on http://localhost:8080\n');
          resolve();
        }
      }).on('error', () => {});
    }, 1000);
  });

  console.log('2. Launching browser and running tests...\n');

  try {
    // Try to use system Chrome
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }).catch(() => {
      return puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }).catch(() => {
      return puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    });

    const page = await browser.newPage();

    // Collect console messages
    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      console.log(text);
    });

    // Navigate to game
    await page.goto('http://localhost:8080', { waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);

    // Click "Run Tests" button
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('canvas'));
      // Simulate click on "Run Tests" button position
      const event = new MouseEvent('click', {
        clientX: 640, // Center X
        clientY: 580  // Approximate Y for "Run Tests" button
      });
      document.body.dispatchEvent(event);
    });

    await page.waitForTimeout(1000);

    // Press 'A' to auto-run all tests
    await page.keyboard.press('a');

    // Wait for tests to complete (21 tests * 2.5s + buffer)
    console.log('\n3. Running 21 tests (this will take ~55 seconds)...\n');
    await page.waitForTimeout(60000);

    await browser.close();
    server.kill();

    console.log('\n' + '='.repeat(70));
    console.log('TEST EXECUTION COMPLETE');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('Error running tests:', error.message);
    console.log('\nFalling back to manual test mode...');
    console.log('Please open http://localhost:8080 in a browser');
    console.log('Click "Run Tests" and press "A" to auto-run');

    // Keep server running
    process.on('SIGINT', () => {
      server.kill();
      process.exit(0);
    });
  }
}

runTests();
