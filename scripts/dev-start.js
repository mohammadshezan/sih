#!/usr/bin/env node

const PortManager = require('./port-manager');
const { spawn } = require('child_process');
const path = require('path');

async function startDevelopment() {
  console.log('🚀 Starting development environment...\n');
  
  const portManager = new PortManager();
  
  // Clean up ports first
  await portManager.cleanupPorts();
  
  console.log('\n📦 Starting services...\n');
  
  // Start the web development server
  const webProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, '..', 'apps', 'web'),
    stdio: 'inherit',
    shell: true
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down development environment...');
    webProcess.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down development environment...');
    webProcess.kill('SIGTERM');
    process.exit(0);
  });
  
  webProcess.on('close', (code) => {
    console.log(`\n✅ Development server exited with code ${code}`);
    process.exit(code);
  });
}

startDevelopment().catch(console.error);