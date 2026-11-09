"use client";

/**
 * <ResponsiveSheet>: one API, two presentations.
 *  - Phones / tablets (< 1024px, and always during SSR + first hydration
 *    render): the existing vaul bottom sheet (Drawer), with the same defaults
 *    the app already uses (`mx-auto max-w-md rounded-t-3xl`).
 *  - Laptops / desktops (≥ 1024px): a centred shadcn Dialog (rounded-3xl,
 *    max-w-lg by default, scrolls inside when tall) with a "Tutup" close button.
 * Both are Radix dialogs underneath: focus trap, Escape to close, focus return
 * to the trigger, aria-labelledby/-describedby from the Title/Description.
 *
 * Usage (drop-in for Drawer / DrawerContent / DrawerHeader / DrawerTitle /
 * DrawerDescription / DrawerFooter / DrawerClose):
 *
 *   <ResponsiveSheet open={open} onOpenChange={setOpen}>
 *     <ResponsiveSheetContent
 *       onOpenAutoFocus={…}                 // optional, forwarded to both
 *       className="…"                       // both variants
 *       drawerClassName="…"                 // phone only (merged after the defaults)
 *       dialogClassName="sm:max-w-2xl"      // desktop only (e.g. wider dialog)
 *       showCloseButton                     // desktop X button, default true
 *     >
 *       <ResponsiveSheetHeader className="text-left">
 *         <ResponsiveSheetTitle>…</ResponsiveSheetTitle>
 *         <ResponsiveSheetDescription>…</ResponsiveSheetDescription>
 *       </ResponsiveSheetHeader>
 *       <ResponsiveSheetBody>…scrollable content…</ResponsiveSheetBody>
 *       <ResponsiveSheetFooter>…buttons…</ResponsiveSheetFooter>
 *     </ResponsiveSheetContent>
 *   </ResponsiveSheet>
 *
 * Slots may live in nested components: they read the variant from context.
 * `useResponsiveSheetVariant()` returns "drawer" | "dialog" for content that
 * needs to adapt (e.g. hide a drag hint on desktop).
 *
 * Migrating: keep the Title/Description (sr-only is fine), keep classes that
 * were on DrawerContent in `className` unless they are phone-only (then
 * `drawerClassName`). The defaults above already include the app's
 * `mx-auto max-w-md rounded-t-3xl`, so passing them again is harmless.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { XIcon } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export const RESPONSIVE_SHEET_DESKTOP_QUERY = "(min-width: 1024px)";

export type ResponsiveSheetVariant = "drawer" | "dialog";

const VariantContext = createContext<ResponsiveSheetVariant>("drawer");
const OpenerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useResponsiveSheetVariant(): ResponsiveSheetVariant {
  return useContext(VariantContext);
}

export function ResponsiveSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  // false on the server and during hydration → phone variant until mounted.
  const desktop = useMediaQuery(RESPONSIVE_SHEET_DESKTOP_QUERY);
  const variant: ResponsiveSheetVariant = desktop ? "dialog" : "drawer";
  // Sheets are opened from state, not a <DialogTrigger>, so Radix has no
  // trigger to refocus on close. Remember the opener ourselves (layout effect:
  // runs before the dialog's FocusScope moves focus inside).
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      openerRef.current = document.activeElement;
    }
  }, [open]);
  return (
    <VariantContext.Provider value={variant}>
      {desktop ? (
        <OpenerContext.Provider value={openerRef}>
          <Dialog open={open} onOpenChange={onOpenChange}>
            {children}
          </Dialog>
        </OpenerContext.Provider>
      ) : (
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      )}
    </VariantContext.Provider>
  );
}

type ContentProps = {
  children: ReactNode;
  className?: string;
  drawerClassName?: string;
  dialogClassName?: string;
  /** Desktop only: top-right "Tutup" button. Default true. */
  showCloseButton?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  "aria-describedby"?: string;
};

export function ResponsiveSheetContent({
  children,
  className,
  drawerClassName,
  dialogClassName,
  showCloseButton = true,
  onCloseAutoFocus,
  ...rest
}: ContentProps) {
  const variant = useResponsiveSheetVariant();
  const openerRef = useContext(OpenerContext);
  if (variant === "drawer") {
    return (
      <DrawerContent
        className={cn("mx-auto max-w-md rounded-t-3xl", className, drawerClassName)}
        onCloseAutoFocus={onCloseAutoFocus}
        {...rest}
      >
        {children}
      </DrawerContent>
    );
  }
  return (
    <DialogContent
      showCloseButton={false}
      className={cn(
        "flex max-h-[min(85dvh,760px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 shadow-float sm:max-w-lg",
        className,
        dialogClassName,
      )}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        const opener = openerRef?.current;
        if (opener?.isConnected) {
          event.preventDefault();
          opener.focus({ preventScroll: true });
        }
      }}
      {...rest}
    >
      {children}
      {showCloseButton && (
        <DialogClose
          className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full bg-background/90 text-muted-foreground ring-1 ring-border transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="Tutup"
        >
          <XIcon className="size-4" aria-hidden />
        </DialogClose>
      )}
    </DialogContent>
  );
}

export function ResponsiveSheetHeader({ className, ...props }: ComponentProps<"div">) {
  const variant = useResponsiveSheetVariant();
  if (variant === "drawer") return <DrawerHeader className={className} {...props} />;
  return <DialogHeader className={cn("gap-0.5 p-4 pt-5 pr-14 text-left", className)} {...props} />;
}

export function ResponsiveSheetTitle({ className, ...props }: ComponentProps<typeof DrawerTitle>) {
  const variant = useResponsiveSheetVariant();
  if (variant === "drawer") return <DrawerTitle className={className} {...props} />;
  return <DialogTitle className={className} {...props} />;
}

export function ResponsiveSheetDescription({ className, ...props }: ComponentProps<typeof DrawerDescription>) {
  const variant = useResponsiveSheetVariant();
  if (variant === "drawer") return <DrawerDescription className={className} {...props} />;
  return <DialogDescription className={className} {...props} />;
}

/** Scrollable middle section (both variants). */
export function ResponsiveSheetBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

export function ResponsiveSheetFooter({ className, ...props }: ComponentProps<"div">) {
  const variant = useResponsiveSheetVariant();
  if (variant === "drawer") return <DrawerFooter className={className} {...props} />;
  // Same layout as DrawerFooter (stacked full-width buttons), not DialogFooter's muted bar.
  return <div data-slot="dialog-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}

export function ResponsiveSheetClose(props: ComponentProps<typeof DrawerClose>) {
  const variant = useResponsiveSheetVariant();
  if (variant === "drawer") return <DrawerClose {...props} />;
  return <DialogClose {...props} />;
}
