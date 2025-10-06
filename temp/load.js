const busy = () => { for (let i=0; i<1e8; i++) {} };
setInterval(busy, 1500); // bursts réguliers
setInterval(() => console.log('[target] alive', Date.now()), 3000);