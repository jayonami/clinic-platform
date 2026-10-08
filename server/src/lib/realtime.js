const clients = new Set();

export function sseHandler(req, res) {
  if (process.env.VERCEL) return res.status(204).end(); // serverless: clients fall back to polling
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

let pending = null;
export function broadcast(scope = 'all') {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const c of clients) c.write(`event: changed\ndata: ${JSON.stringify({ scope, at: Date.now() })}\n\n`);
  }, 80);
}
