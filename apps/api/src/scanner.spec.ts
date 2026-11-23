import { createServer, type Server } from 'node:net';
import { ScannerService } from './scanner';

/**
 * A stand-in clamd that reads the INSTREAM framing and answers like the real one,
 * including dropping the connection without a reply if the client half-closes
 * early (the bug the first version of the scanner had).
 */
function fakeClamd(verdict: (body: Buffer) => string) {
  return new Promise<{ server: Server; port: number }>((resolve) => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      const chunks: Buffer[] = [];
      let halfClosed = false;
      // clamd scans after the stream ends; a client that half-closed by then is dropped unanswered.
      socket.on('end', () => {
        halfClosed = true;
        socket.destroy();
      });
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        const command = 'zINSTREAM\0';
        if (buffer.subarray(0, command.length).toString() === command) buffer = buffer.subarray(command.length);
        while (buffer.length >= 4) {
          const size = buffer.readUInt32BE(0);
          if (size === 0) {
            setTimeout(() => {
              if (!halfClosed) socket.write(`stream: ${verdict(Buffer.concat(chunks))}\0`);
            }, 20);
            return;
          }
          if (buffer.length < 4 + size) return;
          chunks.push(buffer.subarray(4, 4 + size));
          buffer = buffer.subarray(4 + size);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

describe('ScannerService', () => {
  const saved = { ...process.env };
  let server: Server;

  beforeAll(async () => {
    const fake = await fakeClamd((body) =>
      body.includes(Buffer.from('VIRUS')) ? 'Test.Signature FOUND' : 'OK',
    );
    server = fake.server;
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(fake.port);
  });

  afterAll(() => {
    server.close();
    process.env = saved;
  });

  it('reports clean files, including ones larger than one chunk', async () => {
    const scanner = new ScannerService();
    await expect(scanner.scan(Buffer.from('hello'))).resolves.toEqual({ status: 'CLEAN' });
    await expect(scanner.scan(Buffer.alloc(200 * 1024, 65))).resolves.toEqual({ status: 'CLEAN' });
  });

  it('reports infected files with the signature name', async () => {
    await expect(new ScannerService().scan(Buffer.from('a VIRUS here'))).resolves.toEqual({
      status: 'INFECTED',
      detail: 'Test.Signature FOUND',
    });
  });

  it('marks files NOT_SCANNED when no scanner is configured, and SCAN_FAILED when it is unreachable', async () => {
    delete process.env.CLAMAV_HOST;
    await expect(new ScannerService().scan(Buffer.from('x'))).resolves.toEqual({ status: 'NOT_SCANNED' });
    process.env.CLAMAV_HOST = '127.0.0.1';
    const port = process.env.CLAMAV_PORT;
    process.env.CLAMAV_PORT = '1';
    expect((await new ScannerService().scan(Buffer.from('x'))).status).toBe('SCAN_FAILED');
    process.env.CLAMAV_PORT = port;
  });
});
