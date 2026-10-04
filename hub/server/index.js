// Vstupní bod serveru. Normálně ho spouští spoustec.js, který ho po pádu do 5 s spustí znovu.
import { Hub } from './app.js';

process.title = 'DM Hub server';

const hub = new Hub();
try {
  await hub.spustit();
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${hub.nastaveni.port} už používá jiný program. Změň port v hub/.env nebo ten program ukonči.`);
    process.exit(3);
  }
  console.error('Hub se nepodařilo spustit:', e);
  process.exit(1);
}

// Restart z panelu: jen když server spustil spouštěč (ten ho po kódu 75 hned spustí znovu).
if (process.send) {
  hub.restartovat = async () => {
    await hub.zastavit().catch(() => {});
    process.exit(75);
  };
}

console.log(`DM Hub běží na ${hub.adresa}`);
process.send?.({ typ: 'pripraveno', adresa: hub.adresa });

let konci = false;
async function ukoncit() {
  if (konci) return;
  konci = true;
  await hub.zastavit().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', ukoncit);
process.on('SIGTERM', ukoncit);
process.on('message', (z) => z?.typ === 'ukoncit' && ukoncit());
process.on('unhandledRejection', (e) => console.error('Neošetřená chyba:', e));
