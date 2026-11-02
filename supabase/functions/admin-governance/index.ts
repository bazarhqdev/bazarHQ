/**
 * admin-governance — API-32/33/35: themes, announcements and policies.
 *
 *   theme.save / theme.delete               delete blocked while any store uses it;
 *                                           a breaking change sets a 7-day notice
 *   announcement.save (draft|schedule|send) sent announcements are immutable
 *   announcement.unschedule / .delete
 *   policy.submit / .approve / .publish     dual approval: the submitter can't approve
 * Super Admin with a verified TOTP session; available request IP is retained as audit metadata.
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { rpc, serviceClient } from '../_shared/db.ts';
import { handler } from '../_shared/http.ts';
import { parse, uuid, z } from '../_shared/validation.ts';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: 'Use a colour like #059669.' });

const schema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('theme.save'),
    id: uuid.optional(),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(''),
    accent: hex.default('#059669'),
    isActive: z.boolean().default(true),
    breaking: z.boolean().default(false),
    previewUrl: z.string().url().max(500).nullable().optional(),
  }),
  z.object({ op: z.literal('theme.delete'), id: uuid }),
  z.object({
    op: z.literal('announcement.save'),
    id: uuid.optional(),
    title: z.string().trim().min(3).max(150),
    body: z.string().trim().min(10).max(5000),
    audience: z.enum(['all', 'merchants', 'customers']),
    scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
    action: z.enum(['draft', 'schedule', 'send']),
  }),
  z.object({ op: z.literal('announcement.unschedule'), id: uuid }),
  z.object({ op: z.literal('announcement.delete'), id: uuid }),
  z.object({
    op: z.literal('policy.submit'),
    type: z.enum(['tos', 'privacy']),
    version: z.string().trim().min(1).max(20),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use YYYY-MM-DD.' }),
    content: z.string().trim().min(50).max(100_000),
  }),
  z.object({ op: z.literal('policy.approve'), id: uuid }),
  z.object({ op: z.literal('policy.publish'), id: uuid }),
]);

export const serve = handler({ maxBytes: 256 * 1024 }, async ({ req, body }) => {
  const input = parse(schema, body);
  const admin = await requireSuperAdmin(req);
  const db = serviceClient();
  const base = { p_actor_id: admin.id, p_ip: admin.ip };
  switch (input.op) {
    case 'theme.save':
      return await rpc(db, 'admin_save_theme', {
        ...base,
        p_theme_id: input.id ?? null,
        p_input: {
          name: input.name,
          description: input.description,
          accent: input.accent,
          is_active: input.isActive,
          breaking: input.breaking,
          preview_url: input.previewUrl ?? null,
        },
      });
    case 'theme.delete':
      await rpc(db, 'admin_delete_theme', { ...base, p_theme_id: input.id });
      return { deleted: true };
    case 'announcement.save':
      return await rpc(db, 'admin_save_announcement', {
        ...base,
        p_announcement_id: input.id ?? null,
        p_input: { title: input.title, body: input.body, audience: input.audience, scheduled_at: input.scheduledAt, action: input.action },
      });
    case 'announcement.unschedule':
      return await rpc(db, 'admin_unschedule_announcement', { ...base, p_announcement_id: input.id });
    case 'announcement.delete':
      await rpc(db, 'admin_delete_announcement', { ...base, p_announcement_id: input.id });
      return { deleted: true };
    case 'policy.submit':
      return await rpc(db, 'admin_submit_policy', {
        ...base,
        p_type: input.type,
        p_version: input.version,
        p_effective_date: input.effectiveDate,
        p_content: input.content,
      });
    case 'policy.approve':
      return await rpc(db, 'admin_approve_policy', { ...base, p_policy_id: input.id });
    case 'policy.publish':
      return await rpc(db, 'admin_publish_policy', { ...base, p_policy_id: input.id });
  }
});

if (import.meta.main) Deno.serve(serve);
