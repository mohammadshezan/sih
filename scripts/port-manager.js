const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class PortManager {
  constructor() {
    this.ports = {
      web: 3000,
      api: 5000,
      redis: 6379,
      postgres: 5432
    };
  }

  async checkPort(port) {
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      return stdout.trim() !== '';
    } catch (error) {
      return false;
    }
  }

  async killProcessOnPort(port) {
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      if (stdout.trim()) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid)) {
            console.log(`Killing process ${pid} on port ${port}`);
            await execAsync(`taskkill /PID ${pid} /F`);
          }
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error killing process on port ${port}:`, error.message);
      return false;
    }
  }

  async killAllNodeProcesses() {
    try {
      console.log('Killing all Node.js processes...');
      await execAsync('taskkill /IM node.exe /F');
      console.log('All Node.js processes terminated');
      return true;
    } catch (error) {
      console.log('No Node.js processes found or already terminated');
      return false;
    }
  }

  async findAvailablePort(startPort) {
    let port = startPort;
    while (await this.checkPort(port)) {
      port++;
    }
    return port;
  }

  async cleanupPorts() {
    console.log('🧹 Cleaning up ports...');
    
    // Kill all Node.js processes first
    await this.killAllNodeProcesses();
    
    // Wait a moment for processes to fully terminate
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check and clean specific ports
    for (const [service, port] of Object.entries(this.ports)) {
      if (service === 'redis' || service === 'postgres') continue; // Skip Docker services
      
      const isUsed = await this.checkPort(port);
      if (isUsed) {
        console.log(`Port ${port} (${service}) is in use, attempting to free...`);
        await this.killProcessOnPort(port);
      } else {
        console.log(`✅ Port ${port} (${service}) is available`);
      }
    }
    
    console.log('✨ Port cleanup completed!');
  }

  async getAvailablePorts() {
    const availablePorts = {};
    
    for (const [service, defaultPort] of Object.entries(this.ports)) {
      if (service === 'redis' || service === 'postgres') {
        availablePorts[service] = defaultPort; // Docker services
        continue;
      }
      
      const availablePort = await this.findAvailablePort(defaultPort);
      availablePorts[service] = availablePort;
      
      if (availablePort !== defaultPort) {
        console.log(`⚠️  Port ${defaultPort} for ${service} is in use, using ${availablePort} instead`);
      }
    }
    
    return availablePorts;
  }
}

module.exports = PortManager;

// If this script is run directly
if (require.main === module) {
  const portManager = new PortManager();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'cleanup':
      portManager.cleanupPorts();
      break;
    case 'check':
      portManager.getAvailablePorts().then(ports => {
        console.log('Available ports:', ports);
      });
      break;
    default:
      console.log('Usage: node port-manager.js [cleanup|check]');
      console.log('  cleanup - Kill processes and clean up ports');
      console.log('  check   - Check available ports');
  }
}