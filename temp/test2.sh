# Passe à des bursts plus longs:
pkill -f cpu-burst.js
cat > ./cpu-burst.js <<'EOF'
const busy = () => { for (let i=0; i<4e8; i++) {} };  // plus lourd
setInterval(busy, 1000); // plus fréquent
EOF
node ./cpu-burst.js &