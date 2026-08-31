import type { ParentProps } from 'solid-js'
import { splitProps } from 'solid-js'
import * as DialogPrimitive from '@kobalte/core/dialog'
import { cn } from '../../lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.CloseButton

type DialogOverlayProps = DialogPrimitive.DialogOverlayProps & { class?: string }

export function DialogOverlay(props: DialogOverlayProps) {
  const [local, others] = splitProps(props, ['class'])
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        class={cn(
          'fixed inset-0 z-50 bg-black/30 animate-in-fade',
          local.class,
        )}
        {...others}
      />
    </DialogPrimitive.Portal>
  )
}

type DialogContentProps = ParentProps<
  DialogPrimitive.DialogContentProps & {
    class?: string
    title: string
    description?: string
  }
>

export function DialogContent(props: DialogContentProps) {
  const [local, others] = splitProps(props, ['class', 'title', 'description', 'children'])
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        class="fixed inset-0 z-50 bg-black/30 animate-in-fade"
      />
      <DialogPrimitive.Content
        class={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,40rem)] -translate-x-1/2 -translate-y-1/2',
          'flex flex-col rounded-card border border-line bg-surface animate-in-pop',
          local.class,
        )}
        {...others}
      >
        <div class="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <DialogPrimitive.Title class="font-display text-lg font-semibold text-fg">
              {local.title}
            </DialogPrimitive.Title>
            {local.description && (
              <DialogPrimitive.Description class="mt-0.5 text-sm text-fg-muted">
                {local.description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.CloseButton
            class="rounded-md p-1 text-fg-muted transition-colors duration-200 hover:bg-surface-raised hover:text-fg"
            aria-label="Close dialog"
          >
            <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </DialogPrimitive.CloseButton>
        </div>
        <div class="overflow-y-auto px-6 py-5">{local.children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
