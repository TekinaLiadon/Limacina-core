module.exports = {
  apps: [
    {
      name: "Limacina",
      script: "./dist/Limacina",
      interpreter: "none",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
