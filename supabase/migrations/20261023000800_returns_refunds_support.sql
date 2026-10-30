-- =============================================================================
-- Migration 008 — returns (§14.1), refunds (§14.2) and support tickets (§15).
--
-- Returns and refunds move stock and money state, so they are service-role
-- functions behind Edge Functions (request-return, manage-return, process-refund,
-- admin-refund-intervention). Ticket operations are SECURITY DEFINER functions
-- callable by `authenticated` with the actor taken from auth.uid().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Refund immutability (FR-REF-06): facts never change; completed is terminal;
-- references are set once. Applies to every role, including table owners.
-- -----------------------------------------------------------------------------
create or replace function public.guard_refund_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Refund history is retained; DELETE is prohibited' using errcode = '55000';
  end if;
  if new.return_id is distinct from old.return_id or new.amount is distinct from old.amount
     or new.method is distinct from old.method or new.initiator_id is distinct from old.initiator_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Refund amount, method, return and initiator are immutable' using errcode = '55000';
  end if;
  if old.status = 'completed' and (new.status is distinct from old.status
       or new.gateway_reference is distinct from old.gateway_reference
       or new.confirmation_reference is distinct from old.confirmation_reference
       or new.processed_at is distinct from old.processed_at) then
    raise exception 'A completed refund cannot change' using errcode = '55000';
  end if;
  if (old.gateway_reference is not null and new.gateway_reference is distinct from old.gateway_reference)
     or (old.confirmation_reference is not null and new.confirmation_reference is distinct from old.confirmation_reference) then
    raise exception 'Refund references cannot be replaced once recorded' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists refunds_guard_row on public.refunds;
create trigger refunds_guard_row before update or delete on public.refunds
for each row execute function public.guard_refund_row();

create or replace function private.require_return_owner_merchant(p_actor_id uuid, p_return_id uuid)
returns public.returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype;
begin
  select r.* into v_return from public.returns r where r.id = p_return_id for update;
  if not found then
    raise exception 'Return not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orders o join public.stores s on s.id = o.store_id join public.profiles p on p.id = s.owner_id
                 where o.id = v_return.order_id and s.owner_id = p_actor_id and p.role = 'merchant' and p.status = 'active') then
    raise exception 'Only the merchant who owns this order can manage its return' using errcode = '42501';
  end if;
  return v_return;
end;
$$;

create or replace function private.return_result(p_return_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'return', to_jsonb(r),
    'refund', (select to_jsonb(f) from public.refunds f where f.return_id = r.id))
  from public.returns r where r.id = p_return_id;
$$;

-- -----------------------------------------------------------------------------
-- Returns
-- -----------------------------------------------------------------------------

-- FR-RET-01..04: delivered, inside the store's window, one per order.
create or replace function public.request_return(
  p_actor_id uuid, p_order_id uuid, p_reason text, p_condition_description text, p_refund_amount_requested numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_window integer;
  v_return public.returns%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'customer' and status = 'active') then
    raise exception 'Sign in with your customer account to request a return' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = p_actor_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('wrong_item','damaged','not_as_described','change_of_mind','other') then
    raise exception 'Choose a return reason' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_condition_description, ''))) not between 10 and 2000 then
    raise exception 'Describe the item''s condition (10–2000 characters)' using errcode = '22023';
  end if;
  if exists (select 1 from public.returns where order_id = p_order_id) then
    raise exception 'A return has already been requested for this order' using errcode = '23505';
  end if;
  if v_order.status <> 'delivered' or v_order.delivered_at is null then
    raise exception 'Returns are available after the order is delivered' using errcode = '23514';
  end if;
  select return_window_days into v_window from public.stores where id = v_order.store_id;
  if now() > v_order.delivered_at + make_interval(days => v_window) then
    raise exception 'The %-day return window for this order has ended', v_window using errcode = '23514';
  end if;
  if p_refund_amount_requested is not null and (p_refund_amount_requested <= 0 or p_refund_amount_requested > v_order.total_amount) then
    raise exception 'Requested refund must be between 0 and the order total' using errcode = '22023';
  end if;

  insert into public.returns (order_id, customer_id, reason, condition_description, status, refund_amount_requested)
  values (p_order_id, p_actor_id, p_reason, trim(p_condition_description), 'requested',
          coalesce(p_refund_amount_requested, v_order.total_amount))
  returning * into v_return;

  perform private.notify((select owner_id from public.stores where id = v_order.store_id), 'return',
    'Return requested', v_return.return_number || ' for ' || v_order.order_number, 'return', v_return.id);
  perform private.notify(p_actor_id, 'return', 'Return requested',
    v_return.return_number || ' was sent to the store.', 'return', v_return.id);
  return private.return_result(v_return.id);
end;
$$;

-- Evidence photo uploaded to return-evidence/returns/{return_id}/… is attached once (FR-RET-02).
create or replace function public.attach_return_evidence(p_return_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype;
begin
  select * into v_return from public.returns where id = p_return_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Return not found' using errcode = 'P0002';
  end if;
  if v_return.status <> 'requested' or v_return.evidence_storage_path is not null then
    raise exception 'Evidence can be added once while the return is awaiting review' using errcode = '23514';
  end if;
  if p_storage_path not like 'returns/' || p_return_id || '/%'
     or not exists (select 1 from storage.objects where bucket_id = 'return-evidence' and name = p_storage_path) then
    raise exception 'Upload the photo first' using errcode = '22023';
  end if;
  update public.returns set evidence_storage_path = p_storage_path where id = p_return_id;
  return private.return_result(p_return_id);
end;
$$;

-- FR-RET-05/06/07: approve or reject (reason required on rejection).
create or replace function public.decide_return(
  p_actor_id uuid, p_return_id uuid, p_decision text, p_reason text default null, p_return_method text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype := private.require_return_owner_merchant(p_actor_id, p_return_id);
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;
  if v_return.status = p_decision then
    return private.return_result(p_return_id);
  end if;
  if v_return.status <> 'requested' then
    raise exception 'This return has already been decided' using errcode = '23514';
  end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'Give the customer a reason for rejecting (3–1000 characters)' using errcode = '22023';
  end if;
  if p_return_method is not null and p_return_method not in ('customer_drop_off','merchant_coordinated') then
    raise exception 'Unknown return method' using errcode = '22023';
  end if;
  update public.returns
  set status = p_decision, decided_at = now(),
      merchant_response = nullif(trim(coalesce(p_reason, '')), ''),
      return_method = case when p_decision = 'approved' then p_return_method else null end
  where id = p_return_id;
  perform private.audit(p_actor_id, 'return.' || p_decision, 'return', p_return_id,
    jsonb_build_object('reason', left(trim(p_reason), 500)));
  perform private.notify(v_return.customer_id, 'return',
    case when p_decision = 'approved' then 'Return approved' else 'Return rejected' end,
    v_return.return_number || case when p_decision = 'rejected' then ': ' || trim(p_reason) else '' end,
    'return', p_return_id);
  return private.return_result(p_return_id);
end;
$$;

create or replace function public.set_return_method(p_actor_id uuid, p_return_id uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype := private.require_return_owner_merchant(p_actor_id, p_return_id);
begin
  if p_method not in ('customer_drop_off','merchant_coordinated') then
    raise exception 'Unknown return method' using errcode = '22023';
  end if;
  if v_return.status <> 'approved' then
    raise exception 'Set the return method after approving the return' using errcode = '23514';
  end if;
  update public.returns set return_method = p_method where id = p_return_id;
  return private.return_result(p_return_id);
end;
$$;

-- FR-RET-08: receipt + inspection; optional restock exactly once (reason "return").
create or replace function public.confirm_return_receipt(p_actor_id uuid, p_return_id uuid, p_restock boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype := private.require_return_owner_merchant(p_actor_id, p_return_id);
  v_item public.order_items%rowtype;
begin
  if v_return.status = 'received' then
    return private.return_result(p_return_id);
  end if;
  if v_return.status <> 'approved' then
    raise exception 'Only an approved return can be received' using errcode = '23514';
  end if;
  update public.returns set status = 'received', received_at = now() where id = p_return_id;
  if p_restock and v_return.restocked_at is null then
    for v_item in select * from public.order_items where order_id = v_return.order_id order by product_id, variant_id nulls first loop
      perform private.apply_stock_delta(v_item.product_id, v_item.variant_id, v_item.quantity, 'return', p_actor_id,
                                        'return', p_return_id, left(nullif(trim(coalesce(p_note, '')), ''), 500));
    end loop;
    update public.returns set restocked_at = now() where id = p_return_id;
  end if;
  perform private.audit(p_actor_id, 'return.received', 'return', p_return_id,
    jsonb_build_object('restocked', coalesce(p_restock, false), 'note', left(trim(p_note), 500)));
  perform private.notify(v_return.customer_id, 'return', 'Return received',
    v_return.return_number || ' arrived at the store.', 'return', p_return_id);
  return private.return_result(p_return_id);
end;
$$;

create or replace function public.close_return(p_actor_id uuid, p_return_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype := private.require_return_owner_merchant(p_actor_id, p_return_id);
begin
  if v_return.status = 'closed' then
    return private.return_result(p_return_id);
  end if;
  if v_return.status not in ('received','rejected') then
    raise exception 'Only received or rejected returns can be closed' using errcode = '23514';
  end if;
  if v_return.status = 'rejected' and v_return.dispute_status in ('open','info_requested') then
    raise exception 'This return is under Super Admin review' using errcode = '23514';
  end if;
  if exists (select 1 from public.refunds where return_id = p_return_id and status in ('initiated','processing')) then
    raise exception 'Finish the refund before closing the return' using errcode = '23514';
  end if;
  update public.returns set status = 'closed', closed_at = now() where id = p_return_id;
  perform private.audit(p_actor_id, 'return.closed', 'return', p_return_id, jsonb_build_object('note', left(trim(p_note), 500)));
  return private.return_result(p_return_id);
end;
$$;

-- FR-RET-09: customer escalates a rejected return to Super Admin (FR-SA-20).
create or replace function public.escalate_return(p_actor_id uuid, p_return_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype;
begin
  select * into v_return from public.returns where id = p_return_id and customer_id = p_actor_id for update;
  if not found then
    raise exception 'Return not found' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_note, ''))) not between 10 and 2000 then
    raise exception 'Explain why you disagree (10–2000 characters)' using errcode = '22023';
  end if;
  if v_return.status <> 'rejected' or v_return.dispute_status not in ('none','info_requested') then
    raise exception 'Only a rejected return can be escalated, once' using errcode = '23514';
  end if;
  update public.returns set dispute_status = 'open', escalated_at = coalesce(escalated_at, now()) where id = p_return_id;
  perform private.audit(p_actor_id, 'return.escalated', 'return', p_return_id, jsonb_build_object('note', left(trim(p_note), 2000)));
  perform private.notify_super_admins('dispute', 'Return escalated', v_return.return_number || ' needs review.', 'return', p_return_id);
  return private.return_result(p_return_id);
end;
$$;

-- FR-SA-21 on returns: request info, override the merchant (approve), or uphold and close.
create or replace function public.admin_resolve_return_dispute(p_actor_id uuid, p_return_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype;
  v_merchant uuid;
begin
  perform private.require_super_admin(p_actor_id);
  select * into v_return from public.returns where id = p_return_id for update;
  if not found then
    raise exception 'Return not found' using errcode = 'P0002';
  end if;
  if p_action not in ('request_info','override','close') then
    raise exception 'Unknown dispute action' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_note, ''))) not between 3 and 2000 then
    raise exception 'Add a note for the record (3–2000 characters)' using errcode = '22023';
  end if;
  if v_return.dispute_status not in ('open','info_requested') then
    raise exception 'This return has no open dispute' using errcode = '23514';
  end if;
  select s.owner_id into v_merchant from public.orders o join public.stores s on s.id = o.store_id where o.id = v_return.order_id;
  update public.returns set
    dispute_status = case p_action when 'request_info' then 'info_requested' else 'resolved' end,
    dispute_decision = case p_action when 'override' then 'overridden' when 'close' then 'upheld' else dispute_decision end,
    dispute_admin_note = trim(p_note),
    status = case when p_action = 'override' then 'approved' else status end,
    decided_at = case when p_action = 'override' then now() else decided_at end
  where id = p_return_id;
  perform private.audit(p_actor_id, 'dispute.' || p_action, 'return', p_return_id, jsonb_build_object('note', left(trim(p_note), 2000)));
  perform private.notify(v_return.customer_id, 'dispute', 'Update on your return dispute', v_return.return_number || ': ' || left(trim(p_note), 200), 'return', p_return_id);
  perform private.notify(v_merchant, 'dispute', 'BazarHQ reviewed a return', v_return.return_number || ': ' || left(trim(p_note), 200), 'return', p_return_id);
  return private.return_result(p_return_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------

-- FR-REF-01/03: only after approval + confirmed receipt; one per return; idempotent.
create or replace function public.create_refund(p_actor_id uuid, p_return_id uuid, p_amount numeric, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype := private.require_return_owner_merchant(p_actor_id, p_return_id);
  v_order public.orders%rowtype;
  v_existing public.refunds%rowtype;
  v_refund public.refunds%rowtype;
begin
  select * into v_existing from public.refunds where return_id = p_return_id;
  if found then
    if v_existing.amount = p_amount and v_existing.method = p_method then
      return private.return_result(p_return_id);
    end if;
    raise exception 'A refund already exists for this return' using errcode = '23505';
  end if;
  if v_return.status <> 'received' then
    raise exception 'Create the refund after the returned item has been received' using errcode = '23514';
  end if;
  if p_method not in ('original_method','bkash','nagad','rocket','bank_transfer') then
    raise exception 'Unknown refund method' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = v_return.order_id;
  if p_amount is null or p_amount <= 0 or p_amount > v_order.total_amount then
    raise exception 'Refund amount must be between 0 and the order total (%)', v_order.total_amount using errcode = '22023';
  end if;
  if v_order.payment_method = 'cod' and p_method = 'original_method' then
    raise exception 'COD orders are refunded by bank transfer or mobile wallet' using errcode = '23514';
  end if;
  if v_order.payment_status not in ('paid','cod_collected') then
    raise exception 'Nothing was collected for this order, so there is nothing to refund' using errcode = '23514';
  end if;
  insert into public.refunds (return_id, amount, method, status, initiator_id)
  values (p_return_id, p_amount, p_method, 'initiated', p_actor_id)
  returning * into v_refund;
  perform private.audit(p_actor_id, 'refund.status_changed', 'refund', v_refund.id,
    jsonb_build_object('previous_status', null, 'new_status', 'initiated', 'amount', p_amount, 'method', p_method,
                       'order_id', v_order.id));
  perform private.notify(v_return.customer_id, 'refund', 'Refund initiated',
    v_return.return_number || ': ' || p_amount || ' BDT via ' || replace(p_method, '_', ' '), 'refund', v_refund.id);
  return private.return_result(p_return_id);
end;
$$;

-- FR-REF-02/05/07: lifecycle by the owning merchant or (audited) Super Admin intervention.
create or replace function public.update_refund_status(
  p_actor_id uuid, p_refund_id uuid, p_to_status text, p_reference text default null, p_note text default null,
  p_reference_kind text default 'confirmation')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds%rowtype;
  v_return public.returns%rowtype;
  v_order public.orders%rowtype;
  v_is_admin boolean;
  v_allowed text[];
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  select * into v_return from public.returns where id = v_refund.return_id for update;
  select * into v_order from public.orders where id = v_return.order_id for update;
  v_is_admin := exists (select 1 from public.profiles where id = p_actor_id and role = 'super_admin' and status = 'active');
  if not v_is_admin and not exists (
    select 1 from public.stores s join public.profiles p on p.id = s.owner_id
    where s.id = v_order.store_id and s.owner_id = p_actor_id and p.role = 'merchant' and p.status = 'active') then
    raise exception 'Not authorized to update this refund' using errcode = '42501';
  end if;
  if p_to_status not in ('processing','completed','failed') then
    raise exception 'Unsupported refund status' using errcode = '22023';
  end if;
  if v_refund.status = p_to_status then
    return private.return_result(v_return.id);
  end if;
  v_allowed := case v_refund.status
    when 'initiated' then array['processing','completed','failed']
    when 'processing' then array['completed','failed']
    when 'failed' then array['processing']
    else array[]::text[] end;
  if not (p_to_status = any(v_allowed)) then
    raise exception 'A refund cannot move from % to %', v_refund.status, p_to_status using errcode = '23514';
  end if;
  if p_to_status = 'completed' and length(trim(coalesce(p_reference, ''))) not between 3 and 200 then
    raise exception 'A completed refund needs the provider or settlement reference' using errcode = '22023';
  end if;
  if p_to_status = 'failed' and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Explain why the refund failed' using errcode = '22023';
  end if;
  if p_reference_kind not in ('confirmation','gateway') then
    raise exception 'Unknown reference kind' using errcode = '22023';
  end if;

  update public.refunds set
    status = p_to_status,
    processed_at = case when p_to_status = 'completed' then now() else processed_at end,
    confirmation_reference = case when p_to_status = 'completed' and p_reference_kind = 'confirmation' then trim(p_reference) else confirmation_reference end,
    gateway_reference = case when p_to_status = 'completed' and p_reference_kind = 'gateway' then trim(p_reference) else gateway_reference end
  where id = p_refund_id;

  perform private.audit(p_actor_id, case when v_is_admin then 'refund.admin_intervention' else 'refund.status_changed' end,
    'refund', p_refund_id,
    jsonb_build_object('previous_status', v_refund.status, 'new_status', p_to_status, 'reference', trim(p_reference),
                       'note', left(trim(p_note), 500), 'order_id', v_order.id));

  if p_to_status = 'completed' then
    update public.returns set status = 'closed', closed_at = now() where id = v_return.id and status = 'received';
    if v_order.payment_status in ('paid','cod_collected') then
      update public.orders set payment_status = 'refunded' where id = v_order.id;
      perform private.audit(p_actor_id, 'order.payment_status_changed', 'order', v_order.id,
        jsonb_build_object('previous_status', v_order.payment_status, 'new_status', 'refunded', 'source', 'refund_completed',
                           'refund_id', p_refund_id));
    end if;
  end if;
  perform private.notify(v_return.customer_id, 'refund',
    case p_to_status when 'processing' then 'Refund processing' when 'completed' then 'Refund completed' else 'Refund failed' end,
    v_return.return_number || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ''), 'refund', p_refund_id);
  return private.return_result(v_return.id);
end;
$$;

-- FR-REF-07 wrapper with explicit Super Admin check and audited intervention.
create or replace function public.admin_intervene_refund(
  p_actor_id uuid, p_refund_id uuid, p_action text, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin(p_actor_id);
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Interventions need a note for the audit log' using errcode = '22023';
  end if;
  return public.update_refund_status(p_actor_id, p_refund_id,
    case p_action when 'mark_processing' then 'processing' when 'mark_failed' then 'failed' when 'settle' then 'completed'
                  else 'invalid' end,
    p_reference, p_note, 'confirmation');
end;
$$;

-- Immutable refund timeline for customers, merchants and admins (FR-REF-06).
create or replace function public.refund_timeline(p_refund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'status', a.metadata ->> 'new_status',
           'actor_name', p.full_name,
           'note', a.metadata ->> 'note',
           'admin_intervention', a.action = 'refund.admin_intervention',
           'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
  from public.refunds f
  join public.audit_logs a on a.resource_type = 'refund' and a.resource_id = f.id
       and a.action in ('refund.status_changed','refund.admin_intervention')
  left join public.profiles p on p.id = a.actor_id
  where f.id = p_refund_id and public.can_read_return(f.return_id);
$$;

-- -----------------------------------------------------------------------------
-- Support tickets (§15) — actor = auth.uid()
-- -----------------------------------------------------------------------------

create or replace function private.ticket_audit(
  p_ticket_id uuid, p_actor_id uuid, p_event text, p_previous text default null, p_new text default null,
  p_message_id uuid default null, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ticket_audit_log (ticket_id, actor_id, event_type, previous_value, new_value, message_id, metadata)
  values (p_ticket_id, p_actor_id, p_event, p_previous, p_new, p_message_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.notify_ticket_assignee(p_ticket public.support_tickets, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ticket.queue = 'store' and p_ticket.assigned_to is not null then
    perform private.notify(p_ticket.assigned_to, 'support_ticket', p_title, p_body, 'support_ticket', p_ticket.id);
  else
    perform private.notify_super_admins('support_ticket', p_title, p_body, 'support_ticket', p_ticket.id);
  end if;
end;
$$;

-- FR-SUP-01..03: logged-in customers only; routing by category, order and merchant status.
create or replace function public.create_support_ticket(
  p_category text, p_subject text, p_description text, p_priority text default 'normal', p_order_id uuid default null)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_store_category boolean := p_category in ('order','payment','delivery','return_refund');
  v_merchant_active boolean := false;
  v_ticket public.support_tickets%rowtype;
  v_message uuid;
begin
  if not exists (select 1 from public.profiles where id = v_actor and role = 'customer' and status = 'active') then
    raise exception 'Sign in with your customer account to open a ticket' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('order','payment','delivery','return_refund','account','other') then
    raise exception 'Choose a category' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_subject, ''))) not between 3 and 150 then
    raise exception 'Subject must be 3–150 characters' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_description, ''))) not between 10 and 5000 then
    raise exception 'Describe the issue (10–5000 characters)' using errcode = '22023';
  end if;
  if coalesce(p_priority, 'normal') not in ('normal','urgent') then
    raise exception 'Priority must be normal or urgent' using errcode = '22023';
  end if;
  if v_store_category and p_order_id is null then
    raise exception 'Choose the order this is about' using errcode = '22023';
  end if;
  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id and customer_id = v_actor;
    if not found then
      raise exception 'Order not found' using errcode = 'P0002';
    end if;
    select * into v_store from public.stores where id = v_order.store_id;
    v_merchant_active := v_store.status <> 'suspended'
      and exists (select 1 from public.profiles where id = v_store.owner_id and status = 'active');
  end if;

  insert into public.support_tickets (customer_id, store_id, order_id, category, subject, description, priority, status, queue, assigned_to)
  values (v_actor, v_store.id, p_order_id, p_category, trim(p_subject), trim(p_description), coalesce(p_priority, 'normal'), 'open',
          case when v_store_category and v_merchant_active then 'store' else 'platform' end,
          case when v_store_category and v_merchant_active then v_store.owner_id end)
  returning * into v_ticket;

  insert into public.ticket_messages (ticket_id, sender_id, body) values (v_ticket.id, v_actor, trim(p_description))
  returning id into v_message;
  perform private.ticket_audit(v_ticket.id, v_actor, 'created', null, 'open', v_message,
    jsonb_build_object('queue', v_ticket.queue, 'category', v_ticket.category));
  if v_ticket.assigned_to is not null then
    perform private.ticket_audit(v_ticket.id, null, 'assigned', null, 'store_merchant');
  end if;
  perform private.notify_ticket_assignee(v_ticket, 'New support ticket', v_ticket.ticket_number || ': ' || v_ticket.subject);
  perform private.notify(v_actor, 'support_ticket', 'Ticket received',
    v_ticket.ticket_number || ' was sent to ' || case when v_ticket.queue = 'store' then v_store.name else 'BazarHQ support' end || '.',
    'support_ticket', v_ticket.id);
  return v_ticket;
end;
$$;

create or replace function private.ticket_actor_kind(p_ticket public.support_tickets, p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_ticket.customer_id = p_actor then 'customer'
    when p_ticket.queue = 'store' and p_ticket.assigned_to = p_actor
         and exists (select 1 from public.stores s join public.profiles p on p.id = s.owner_id
                     where s.id = p_ticket.store_id and s.owner_id = p_actor and p.status = 'active') then 'merchant'
    when public.is_super_admin() then 'super_admin'
    else null end;
$$;

-- FR-SUP-05/06: replies are append-only; first public merchant reply stops the 72-hour clock.
create or replace function public.reply_to_ticket(p_ticket_id uuid, p_body text, p_attachment_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ticket public.support_tickets%rowtype;
  v_kind text;
  v_message uuid;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  v_kind := private.ticket_actor_kind(v_ticket, v_actor);
  if v_kind is null then
    raise exception 'Not authorized for this ticket' using errcode = '42501';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'This ticket is closed. Reopen it to continue the conversation.' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Write a reply (up to 5000 characters)' using errcode = '22023';
  end if;
  if p_attachment_path is not null and (
       p_attachment_path not like 'tickets/' || p_ticket_id || '/%'
       or not exists (select 1 from storage.objects where bucket_id = 'support-attachments' and name = p_attachment_path)) then
    raise exception 'Upload the attachment first' using errcode = '22023';
  end if;

  insert into public.ticket_messages (ticket_id, sender_id, body, attachment_storage_path)
  values (p_ticket_id, v_actor, trim(p_body), p_attachment_path)
  returning id into v_message;
  perform private.ticket_audit(p_ticket_id, v_actor, 'reply', null, null, v_message, jsonb_build_object('sender', v_kind));

  if v_kind = 'customer' then
    if v_ticket.status = 'waiting_for_customer' then
      update public.support_tickets set status = 'in_progress' where id = p_ticket_id;
      perform private.ticket_audit(p_ticket_id, v_actor, 'status_changed', 'waiting_for_customer', 'in_progress');
    end if;
    if v_ticket.dispute_status = 'info_requested' then
      update public.support_tickets set dispute_status = 'open' where id = p_ticket_id;
    end if;
    perform private.notify_ticket_assignee(v_ticket, 'Customer replied', v_ticket.ticket_number || ': ' || left(trim(p_body), 100));
  else
    update public.support_tickets
    set first_merchant_response_at = case when v_kind = 'merchant' then coalesce(first_merchant_response_at, now()) else first_merchant_response_at end,
        updated_at = now()
    where id = p_ticket_id;
    perform private.notify(v_ticket.customer_id, 'support_ticket', 'New reply on ' || v_ticket.ticket_number,
      left(trim(p_body), 200), 'support_ticket', p_ticket_id);
  end if;
  return v_message;
end;
$$;

-- FR-SUP-04/08: Open → In Progress → Waiting for Customer → Resolved → Closed.
create or replace function public.update_ticket_status(p_ticket_id uuid, p_to_status text, p_resolution_note text default null)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ticket public.support_tickets%rowtype;
  v_kind text;
  v_allowed text[];
  v_previous text;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  v_previous := v_ticket.status;
  v_kind := private.ticket_actor_kind(v_ticket, v_actor);
  if v_kind is null or v_kind = 'customer' then
    raise exception 'Only the assigned merchant or a Super Admin can change ticket status' using errcode = '42501';
  end if;
  if v_ticket.status = p_to_status then
    return v_ticket;
  end if;
  v_allowed := case v_ticket.status
    when 'open' then array['in_progress']
    when 'in_progress' then array['waiting_for_customer','resolved']
    when 'waiting_for_customer' then array['in_progress','resolved']
    when 'resolved' then array['closed']
    else array[]::text[] end;
  if not (p_to_status = any(v_allowed)) then
    raise exception 'A ticket cannot move from % to %', v_ticket.status, p_to_status using errcode = '23514';
  end if;
  if p_to_status = 'resolved' and length(trim(coalesce(p_resolution_note, ''))) not between 3 and 2000 then
    raise exception 'Add a resolution note (3–2000 characters)' using errcode = '22023';
  end if;
  update public.support_tickets
  set status = p_to_status,
      resolution_note = case when p_to_status = 'resolved' then trim(p_resolution_note) else resolution_note end,
      closed_at = case when p_to_status = 'closed' then now() else closed_at end
  where id = p_ticket_id
  returning * into v_ticket;
  perform private.ticket_audit(p_ticket_id, v_actor, case when p_to_status = 'closed' then 'closed' else 'status_changed' end,
                               v_previous, p_to_status);
  perform private.notify(v_ticket.customer_id, 'support_ticket', v_ticket.ticket_number || ' updated',
    'Status: ' || replace(p_to_status, '_', ' '), 'support_ticket', p_ticket_id);
  return v_ticket;
end;
$$;

create or replace function public.set_ticket_priority(p_ticket_id uuid, p_priority text)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if p_priority not in ('normal','urgent') then
    raise exception 'Priority must be normal or urgent' using errcode = '22023';
  end if;
  if v_ticket.status in ('resolved','closed') then
    raise exception 'Priority can''t be changed after a ticket is resolved' using errcode = '23514';
  end if;
  if v_ticket.priority <> p_priority then
    update public.support_tickets set priority = p_priority where id = p_ticket_id returning * into v_ticket;
    perform private.ticket_audit(p_ticket_id, (select auth.uid()), 'priority_changed', v_ticket.priority, p_priority);
  end if;
  return v_ticket;
end;
$$;

-- FR-SUP-04: Customer may reopen within 7 calendar days of closure; history preserved.
create or replace function public.reopen_ticket(p_ticket_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if v_ticket.status <> 'closed' or v_ticket.closed_at < now() - interval '7 days' then
    raise exception 'Closed tickets can be reopened within 7 days of closure. Please open a new ticket.' using errcode = '23514';
  end if;
  update public.support_tickets set status = 'open', closed_at = null where id = p_ticket_id returning * into v_ticket;
  perform private.ticket_audit(p_ticket_id, (select auth.uid()), 'reopened', 'closed', 'open');
  perform private.notify_ticket_assignee(v_ticket, 'Ticket reopened', v_ticket.ticket_number || ' was reopened by the customer.');
  return v_ticket;
end;
$$;

-- FR-SUP-10: escalate after 72 elapsed hours without a public merchant reply. Reassignment never resets the clock
-- because it is measured from created_at.
create or replace function public.escalate_ticket(p_ticket_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if v_ticket.queue <> 'store' or v_ticket.escalation_at is not null or v_ticket.first_merchant_response_at is not null
     or v_ticket.status in ('resolved','closed') or v_ticket.created_at > now() - interval '72 hours' then
    raise exception 'You can escalate to BazarHQ when the store hasn''t replied within 72 hours of the ticket being opened' using errcode = '23514';
  end if;
  update public.support_tickets
  set queue = 'platform', assigned_to = null, escalation_at = now(), dispute_status = 'open'
  where id = p_ticket_id returning * into v_ticket;
  perform private.ticket_audit(p_ticket_id, (select auth.uid()), 'escalated', 'store', 'platform');
  perform private.audit((select auth.uid()), 'ticket.escalated', 'support_ticket', p_ticket_id);
  perform private.notify_super_admins('dispute', 'Ticket escalated', v_ticket.ticket_number || ': ' || v_ticket.subject,
                                      'support_ticket', p_ticket_id);
  return v_ticket;
end;
$$;

-- Super Admin reassignment (timer unaffected) and dispute actions (FR-SA-20/21).
create or replace function public.admin_assign_ticket(p_ticket_id uuid, p_assignee uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_previous uuid;
  v_role text;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  v_previous := v_ticket.assigned_to;
  select role into v_role from public.profiles where id = p_assignee and status = 'active';
  if v_role = 'super_admin' then
    update public.support_tickets set assigned_to = p_assignee, queue = 'platform' where id = p_ticket_id returning * into v_ticket;
  elsif v_role = 'merchant' and exists (select 1 from public.stores where id = v_ticket.store_id and owner_id = p_assignee and status <> 'suspended') then
    update public.support_tickets set assigned_to = p_assignee, queue = 'store' where id = p_ticket_id returning * into v_ticket;
  else
    raise exception 'Assign to an active Super Admin or the store''s active merchant' using errcode = '23514';
  end if;
  perform private.ticket_audit(p_ticket_id, (select auth.uid()), 'assigned', v_previous::text, p_assignee::text);
  perform private.audit((select auth.uid()), 'ticket.reassigned', 'support_ticket', p_ticket_id,
                        jsonb_build_object('previous', v_previous, 'new', p_assignee));
  return v_ticket;
end;
$$;

create or replace function public.admin_resolve_ticket_dispute(p_ticket_id uuid, p_action text, p_note text)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  if p_action not in ('request_info','override','close') then
    raise exception 'Unknown dispute action' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_note, ''))) not between 3 and 2000 then
    raise exception 'Add a note for the record (3–2000 characters)' using errcode = '22023';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if v_ticket.dispute_status not in ('open','info_requested') then
    raise exception 'This ticket has no open dispute' using errcode = '23514';
  end if;
  update public.support_tickets set
    dispute_status = case when p_action = 'request_info' then 'info_requested' else 'resolved' end,
    dispute_decision = case p_action when 'override' then 'overridden' when 'close' then 'upheld' else dispute_decision end,
    dispute_admin_note = trim(p_note),
    status = case when p_action = 'request_info' then 'waiting_for_customer'
                  when status in ('resolved','closed') then status else 'resolved' end,
    resolution_note = case when p_action <> 'request_info' and status not in ('resolved','closed') then trim(p_note) else resolution_note end
  where id = p_ticket_id returning * into v_ticket;
  perform private.ticket_audit(p_ticket_id, (select auth.uid()), 'dispute_action', null, p_action);
  perform private.audit((select auth.uid()), 'dispute.' || p_action, 'support_ticket', p_ticket_id,
                        jsonb_build_object('note', left(trim(p_note), 2000)));
  perform private.notify(v_ticket.customer_id, 'dispute', 'Update on ' || v_ticket.ticket_number, left(trim(p_note), 200),
                         'support_ticket', p_ticket_id);
  return v_ticket;
end;
$$;

-- Thread with display names, for participants only (FR-SUP-09).
create or replace function public.get_ticket_thread(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'ticket_id', m.ticket_id, 'sender_id', m.sender_id, 'sender_name', p.full_name, 'sender_role', p.role,
        'body', m.body, 'attachment_storage_path', m.attachment_storage_path, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.ticket_messages m join public.profiles p on p.id = m.sender_id where m.ticket_id = p_ticket_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'ticket_id', a.ticket_id, 'actor_name', p.full_name, 'event_type', a.event_type,
        'previous_value', a.previous_value, 'new_value', a.new_value, 'created_at', a.created_at) order by a.created_at, a.id)
      from public.ticket_audit_log a left join public.profiles p on p.id = a.actor_id where a.ticket_id = p_ticket_id), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_super_admin(), public.owns_store(uuid), public.owns_product(uuid), public.owns_order(uuid),
  public.can_read_order(uuid), public.can_read_return(uuid), public.can_access_ticket(uuid),
  public.current_user_id(), public.current_active_app_role(), public.current_store_id(),
  public.is_merchant(), public.is_customer()
to anon, authenticated, service_role;
grant execute on function public.resolve_store(text), public.search_stores(text, integer),
  public.validate_cart(uuid, jsonb, text) to anon, authenticated;
grant execute on function
  public.become_merchant(), public.check_subdomain(text), public.create_store(text, text, text, text), public.get_onboarding_progress(),
  public.publish_store(), public.unpublish_store(), public.get_payment_configs(), public.set_payment_method_enabled(text, boolean),
  public.create_product(jsonb), public.update_product(uuid, jsonb), public.set_product_status(uuid, text),
  public.delete_product(uuid), public.duplicate_product(uuid, jsonb),
  public.attach_return_evidence(uuid, text), public.refund_timeline(uuid),
  public.create_support_ticket(text, text, text, text, uuid), public.reply_to_ticket(uuid, text, text),
  public.update_ticket_status(uuid, text, text), public.set_ticket_priority(uuid, text), public.reopen_ticket(uuid),
  public.escalate_ticket(uuid), public.admin_assign_ticket(uuid, uuid), public.admin_resolve_ticket_dispute(uuid, text, text),
  public.get_ticket_thread(uuid)
to authenticated;
grant execute on function
  public.request_return(uuid, uuid, text, text, numeric), public.decide_return(uuid, uuid, text, text, text),
  public.set_return_method(uuid, uuid, text), public.confirm_return_receipt(uuid, uuid, boolean, text),
  public.close_return(uuid, uuid, text), public.escalate_return(uuid, uuid, text),
  public.admin_resolve_return_dispute(uuid, uuid, text, text),
  public.create_refund(uuid, uuid, numeric, text), public.update_refund_status(uuid, uuid, text, text, text, text),
  public.admin_intervene_refund(uuid, uuid, text, text, text)
to service_role;
