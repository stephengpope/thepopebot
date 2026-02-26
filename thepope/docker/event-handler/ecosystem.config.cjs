module.exports = {
  apps: [{
    name: 'next',
    script: 'node_modules/.bin/next',
    args: 'start -p 80',
    kill_timeout: 120000,
  }]
};
