// Only a watchdog regression fixture; no service or network access.
const { monotonic } = require('../../dist/ha/supervisorClock')
process.send({ type: 'ha-heartbeat', deadline: monotonic() + 1000 })
while (true) { /* deliberately stall this process's event loop */ }
