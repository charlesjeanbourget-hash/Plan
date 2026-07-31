import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const DropdownMenu: React.FC<{ open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode }>;

export const DropdownMenuTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean } & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;

export const DropdownMenuContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end'; sideOffset?: number } & DataAttrs & React.RefAttributes<HTMLDivElement>
>;

export const DropdownMenuItem: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean; disabled?: boolean; onSelect?: (event: Event) => void } & DataAttrs & React.RefAttributes<HTMLDivElement>
>;

export const DropdownMenuLabel: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean } & DataAttrs & React.RefAttributes<HTMLDivElement>
>;

export const DropdownMenuSeparator: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & DataAttrs & React.RefAttributes<HTMLDivElement>
>;
