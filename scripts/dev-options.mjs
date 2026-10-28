// Development-only options. Never expose the local SQLite adapter off loopback.
export function parseDevOptions(args) {
  const options = { host: '127.0.0.1', port: 8792 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--host', '--port', '--strictPort'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--strictPort') continue; // Ports are always strict; never choose a fallback.
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--host') {
      if (value !== '127.0.0.1') throw new Error('--host must be 127.0.0.1 (loopback only).');
      options.host = value;
    } else {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 65535) throw new Error('--port must be an integer from 1 to 65535.');
      options.port = Number(value);
    }
  }
  return options;
}
