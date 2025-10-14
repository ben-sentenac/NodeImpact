// process vivant jusqu'à arrêt explicite
process.title = `sleepy ${process.argv.slice(2).join(' ')}`;
const keepAlive = setInterval(() => {}, 1e6);

// arrêt propre
function shutdown(code = 0) {
  clearInterval(keepAlive);
  try { process.exit(code); } catch {}
}

// écoute des signaux (unix)
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// arrêt par IPC (recommandé en tests)
process.on('message', (m) => {
  if (m && m.type === 'stop') shutdown(0);
});

// si le parent disparaît (canal IPC fermé)
process.on('disconnect', () => shutdown(0));