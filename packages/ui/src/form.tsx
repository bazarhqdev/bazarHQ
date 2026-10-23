'use client';

/**
 * React Hook Form + Zod glue. Schemas live in @bazarhq/shared so web, mobile
 * and the (future) server validate with identical rules and messages.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { isServiceError, type z } from '@bazarhq/shared';

export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  defaultValues: DefaultValues<z.input<TSchema>>,
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    // zodResolver's generics are wider than ours; the schema is the single source of truth.
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    mode: 'onTouched',
  });
}

/** Copy server-side field errors (ServiceError.fieldErrors) onto the form. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, error: unknown): boolean {
  if (!isServiceError(error) || !error.fieldErrors) return false;
  for (const [key, message] of Object.entries(error.fieldErrors)) {
    form.setError(key as Path<T>, { type: 'server', message });
  }
  return true;
}
