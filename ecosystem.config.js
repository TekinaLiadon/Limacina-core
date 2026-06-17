module.exports = {
  apps: [
    {
      name: 'Limacina',
      script: 'pm2-bootstrap.js',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
