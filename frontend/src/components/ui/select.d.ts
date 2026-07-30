import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export function Select(props: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element;

export const SelectTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;

export function SelectValue(props: {
  placeholder?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element;

export const SelectContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { position?: string } & React.RefAttributes<HTMLDivElement>
>;

export const SelectItem: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean } & DataAttrs & React.RefAttributes<HTMLDivElement>
>;

export const SelectGroup: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SelectLabel: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SelectSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>>;
