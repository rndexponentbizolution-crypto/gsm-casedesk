import { z } from 'zod';

export const ticketStatuses = [
  'NEW',
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_INFORMATION',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const sendMessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1).max(4096).optional(),
  attachmentId: z.string().uuid().optional(),
}).refine((value) => value.body || value.attachmentId, {
  message: 'A message or attachment is required',
});

export const simulateInboundSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  text: z.string().trim().min(1).max(4096).optional(),
  mediaType: z.enum(['image', 'document', 'audio']).optional(),
  duplicate: z.boolean().optional(),
  providerId: z.string().trim().min(1).max(200).optional(),
});
