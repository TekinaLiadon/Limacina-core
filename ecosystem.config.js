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
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
