module.exports = {
  apps: [
    {
      name: 'voidtune',
      script: 'dist/index.js',
      cwd: './',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/voidtune-out.log',
      error_file: './logs/voidtune-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
