import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';

/** Attachment.scanStatus values. Only CLEAN and NOT_SCANNED files are served. */
export type ScanStatus = 'CLEAN' | 'INFECTED' | 'NOT_SCANNED' | 'SCAN_FAILED';

export const SERVABLE: ScanStatus[] = ['CLEAN', 'NOT_SCANNED'];

/**
 * Scans attachments with ClamAV (clamd) over its INSTREAM protocol when CLAMAV_HOST
 * is set. Without it, files are marked NOT_SCANNED rather than pretending to be clean.
 */
@Injectable()
export class ScannerService {
  private readonly host = process.env.CLAMAV_HOST?.trim();
  private readonly port = Number(process.env.CLAMAV_PORT ?? 3310);
  private readonly timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30000);

  get enabled() {
    return Boolean(this.host);
  }

  async scan(body: Buffer): Promise<{ status: ScanStatus; detail?: string }> {
    if (!this.host) return { status: 'NOT_SCANNED' };
    try {
      const reply = await this.instream(body);
      if (/:\s*OK$/.test(reply)) return { status: 'CLEAN' };
      if (/FOUND$/.test(reply))
        return { status: 'INFECTED', detail: reply.replace(/^stream:\s*/, '') };
      return { status: 'SCAN_FAILED', detail: reply };
    } catch (error) {
      return { status: 'SCAN_FAILED', detail: (error as Error).message };
    }
  }

  private instream(body: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let reply = '';
      socket.setTimeout(this.timeoutMs, () => {
        socket.destroy();
        reject(new Error('ClamAV scan timed out'));
      });
      const finish = () => {
        socket.destroy();
        resolve(reply.replace(/\0/g, '').trim());
      };
      socket.on('error', reject);
      // "z" commands get a NUL-terminated reply. Keep the connection open until it
      // arrives: half-closing early makes clamd drop the stream without answering.
      socket.on('data', (chunk) => {
        reply += chunk.toString('utf8');
        if (reply.includes('\0')) finish();
      });
      socket.on('end', finish);
      socket.connect(this.port, this.host!, () => {
        socket.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let offset = 0; offset < body.length; offset += CHUNK) {
          const part = body.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      });
    });
  }
}
